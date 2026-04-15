"""LlamaIndex QueryEngine over hybrid + rerank for Phase 3 rulebook Q&A (decoupled from extraction)."""

from __future__ import annotations

import os
from pathlib import Path

from llama_index.core.bridge.pydantic import Field
from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.prompts import PromptTemplate
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.response_synthesizers import ResponseMode, get_response_synthesizer
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from llama_index.llms.bedrock_converse import BedrockConverse
from llama_index.llms.google_genai import GoogleGenAI
from llama_index.llms.openai_like import OpenAILike
from llama_index.llms.openrouter import OpenRouter
from ingestion.bm25_retriever import BoardruleBM25Retriever
from ingestion.hybrid_retriever import HybridFusionRetriever
from ingestion.node_builders import format_header_path_for_prompt
from ingestion.index_builder import (
    _effective_local_rerank_hf_name,
    build_embedding_model,
    game_index_dir,
    load_manifest,
    load_vector_index,
    retrieval_config_from_manifest,
)
from ingestion.index_storage_remote import ensure_game_index_local
from ingestion.jina_rerank import JinaRerankPostprocessor
from ingestion.rerank_cache import get_cached_sentence_transformer_rerank
from utils.ai_gateway import RerankSlotJina, get_rerank_slot, get_slots
from utils.dashscope_client import resolve_dashscope_api_base

_BM25_SUBDIR = "bm25"


def _openrouter_chat_context_window() -> int:
    """
    LlamaIndex ``OpenAI`` infers context size only for official OpenAI model ids; OpenRouter ids
    (e.g. ``meta-llama/...``) require an explicit window. Override via ``OPENROUTER_CHAT_CONTEXT_WINDOW``.
    """
    raw = (os.environ.get("OPENROUTER_CHAT_CONTEXT_WINDOW") or "").strip()
    if not raw:
        return 128_000
    try:
        return max(1024, int(raw))
    except ValueError:
        return 128_000


def _qwen_chat_context_window() -> int:
    """
    DashScope OpenAI-compatible ids (e.g. ``qwen-turbo``) are not in LlamaIndex's OpenAI map;
    set an explicit window. Override via ``QWEN_CHAT_CONTEXT_WINDOW``.
    """
    raw = (os.environ.get("QWEN_CHAT_CONTEXT_WINDOW") or "").strip()
    if not raw:
        return 128_000
    try:
        return max(1024, int(raw))
    except ValueError:
        return 128_000


def get_chat_llm() -> GoogleGenAI | OpenRouter | OpenAILike | BedrockConverse:
    c = get_slots().chat
    if c.provider == "openrouter":
        return OpenRouter(
            model=c.model,
            api_key=c.api_key,
            temperature=float(c.temperature),
            max_tokens=int(c.max_tokens),
            context_window=_openrouter_chat_context_window(),
        )
    if c.provider == "qwen":
        return OpenAILike(
            model=c.model,
            api_key=c.api_key,
            api_base=resolve_dashscope_api_base(c.dashscope_compatible_base),
            temperature=float(c.temperature),
            max_tokens=int(c.max_tokens),
            context_window=_qwen_chat_context_window(),
            is_chat_model=True,
        )
    if c.provider == "bedrock":
        rn = (c.bedrock_region or "").strip()
        mode = c.bedrock_auth_mode
        if not rn or mode not in ("iam", "api_key"):
            raise RuntimeError("Chat slot: Bedrock requires bedrockRegion and bedrockAuthMode (iam | api_key)")
        if mode == "iam":
            aid = (c.aws_access_key_id or "").strip()
            if not aid:
                raise RuntimeError("Chat slot: Bedrock IAM requires awsAccessKeyId")
            return BedrockConverse(
                model=c.model,
                region_name=rn,
                temperature=float(c.temperature),
                max_tokens=int(c.max_tokens),
                aws_access_key_id=aid,
                aws_secret_access_key=c.api_key,
                aws_session_token=c.aws_session_token,
            )
        k = "AWS_BEARER_TOKEN_BEDROCK"
        prev = os.environ.get(k)
        os.environ[k] = c.api_key
        try:
            return BedrockConverse(
                model=c.model,
                region_name=rn,
                temperature=float(c.temperature),
                max_tokens=int(c.max_tokens),
            )
        finally:
            if prev is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = prev
    return GoogleGenAI(
        model=c.model,
        api_key=c.api_key,
        temperature=float(c.temperature),
        max_tokens=int(c.max_tokens),
    )


class TruncateNodesPostprocessor(BaseNodePostprocessor):
    """Cap the number of retrieved nodes when cross-encoder rerank is disabled."""

    top_n: int = Field(default=5, ge=1, description="Max nodes to pass through after retrieval.")

    def _postprocess_nodes(
        self,
        nodes: list[NodeWithScore],
        query_bundle: QueryBundle | None = None,
    ) -> list[NodeWithScore]:
        return nodes[: self.top_n]


class PageMetadataPrefixPostprocessor(BaseNodePostprocessor):
    """Prepend page range to each chunk so the LLM cites sources."""

    def _postprocess_nodes(
        self,
        nodes: list[NodeWithScore],
        query_bundle: QueryBundle | None = None,
    ) -> list[NodeWithScore]:
        out: list[NodeWithScore] = []
        for nws in nodes:
            node = nws.node
            meta = getattr(node, "metadata", {}) or {}
            pages = meta.get("pages") or meta.get("original_page_range")
            hp = format_header_path_for_prompt(meta.get("header_path"))
            lines: list[str] = []
            if pages:
                lines.append(f"[页码: {pages}]")
            if hp:
                lines.append(f"[章节: {hp}]")
            prefix = ("\n".join(lines) + "\n") if lines else ""
            body = node.get_content() if hasattr(node, "get_content") else str(getattr(node, "text", ""))
            new_node = TextNode(
                text=prefix + body,
                metadata=meta,
                id_=node.node_id,
            )
            out.append(NodeWithScore(node=new_node, score=nws.score))
        return out


def _load_chat_system_markdown() -> str:
    """Persona + rules from ``prompts/chat_system.md`` (single source for chat tone)."""
    path = Path(__file__).resolve().parent.parent / "prompts" / "chat_system.md"
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    return (
        "你是桌游规则助手。仅根据下方「规则书片段」回答，使用简体中文。\n"
        "若片段不足以回答，请明确说明「规则书中未找到相关说明」。"
    )


# One-shot QA: ``simple_summarize`` avoids ``compact``'s multi-step **English** ``refine`` prompts.
_RULE_QA_TEMPLATE = PromptTemplate(
    _load_chat_system_markdown()
    + "\n\n"
    "【规则书片段】（回答时的唯一事实来源；严格遵守上文原则）：\n\n"
    "---------------------\n"
    "{context_str}\n"
    "---------------------\n\n"
    "玩家问题：{query_str}\n\n"
    "请直接输出给玩家的回答："
)


def build_rulebook_query_engine(game_id: str, *, streaming: bool = False) -> RetrieverQueryEngine:
    """
    Retrieval and postprocessing follow ``manifest.json`` for this ``game_id`` (written at index build).

    Changing Embed / Chat models in the gateway does not require a rebuild; changing retrieval
    fields in the manifest does (rebuild index), except rerank is query-time-only—manifest still
    records whether to run it.
    """
    ensure_game_index_local(game_id)
    root = game_index_dir(game_id)
    if not (root / "manifest.json").is_file():
        raise FileNotFoundError(f"No index manifest for game_id={game_id}")
    manifest = load_manifest(game_id)
    if not manifest:
        raise FileNotFoundError(f"No index manifest for game_id={game_id}")
    cfg = retrieval_config_from_manifest(manifest)

    embed_model = build_embedding_model()
    llm = get_chat_llm()

    index = load_vector_index(game_id, embed_model=embed_model)
    vector_retriever = index.as_retriever(similarity_top_k=cfg.similarity_top_k)
    if cfg.retrieval_mode == "vector_only":
        retriever = vector_retriever
    else:
        bm25_dir = root / _BM25_SUBDIR
        if not bm25_dir.is_dir():
            raise FileNotFoundError(
                "Hybrid retrieval requires BM25 data. Rebuild the index with retrieval mode hybrid."
            )
        bm25 = BoardruleBM25Retriever.from_persist_dir(str(bm25_dir))
        retriever = HybridFusionRetriever(
            bm25,
            vector_retriever,
            similarity_top_k=cfg.similarity_top_k,
        )

    page_pp = PageMetadataPrefixPostprocessor()
    if cfg.use_rerank:
        rs = get_rerank_slot()
        if isinstance(rs, RerankSlotJina):
            rerank: BaseNodePostprocessor = JinaRerankPostprocessor(
                api_key=rs.api_key,
                model=rs.model,
                top_n=cfg.rerank_top_n,
            )
        else:
            rerank = get_cached_sentence_transformer_rerank(
                model=_effective_local_rerank_hf_name(),
                top_n=cfg.rerank_top_n,
            )
        node_postprocessors: list[BaseNodePostprocessor] = [rerank, page_pp]
    else:
        node_postprocessors = [TruncateNodesPostprocessor(top_n=cfg.rerank_top_n), page_pp]

    response_synthesizer = get_response_synthesizer(
        llm=llm,
        text_qa_template=_RULE_QA_TEMPLATE,
        response_mode=ResponseMode.SIMPLE_SUMMARIZE,
        streaming=streaming,
    )

    # ``from_args`` always runs ``llm = llm or Settings.llm`` before using a custom
    # ``response_synthesizer``; omitting ``llm`` touches ``Settings.llm`` and forces
    # the default OpenAI client (requires OPENAI_API_KEY). Pass our chat LLM explicitly.
    return RetrieverQueryEngine.from_args(
        retriever=retriever,
        llm=llm,
        node_postprocessors=node_postprocessors,
        response_synthesizer=response_synthesizer,
    )
