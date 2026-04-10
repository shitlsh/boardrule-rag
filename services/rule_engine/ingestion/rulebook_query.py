"""LlamaIndex QueryEngine over hybrid + rerank for Phase 3 rulebook Q&A (decoupled from extraction)."""

from __future__ import annotations

from pathlib import Path

from llama_index.core import Settings
from llama_index.core.bridge.pydantic import Field
from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.prompts import PromptTemplate
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.response_synthesizers import ResponseMode, get_response_synthesizer
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from llama_index.llms.google_genai import GoogleGenAI
from llama_index.llms.openai import OpenAI as OpenAILlm
from ingestion.bm25_retriever import BoardruleBM25Retriever
from ingestion.hybrid_retriever import HybridFusionRetriever
from ingestion.node_builders import format_header_path_for_prompt
from ingestion.index_builder import (
    _rerank_model_name,
    configure_embedding_settings,
    game_index_dir,
    load_manifest,
    load_vector_index,
    retrieval_config_from_manifest,
)
from ingestion.index_storage_remote import ensure_game_index_local
from ingestion.rerank_cache import get_cached_sentence_transformer_rerank
from utils.ai_gateway import get_slots
from utils.openrouter_client import OPENROUTER_API_BASE

_BM25_SUBDIR = "bm25"


def get_chat_llm() -> GoogleGenAI | OpenAILlm:
    c = get_slots().chat
    if c.provider == "openrouter":
        return OpenAILlm(
            model=c.model,
            api_key=c.api_key,
            api_base=OPENROUTER_API_BASE,
            temperature=float(c.temperature),
            max_tokens=int(c.max_tokens),
        )
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


def build_rulebook_query_engine(game_id: str) -> RetrieverQueryEngine:
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

    configure_embedding_settings()
    llm = get_chat_llm()
    Settings.llm = llm

    index = load_vector_index(game_id)
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
        rerank = get_cached_sentence_transformer_rerank(
            model=_rerank_model_name(),
            top_n=cfg.rerank_top_n,
        )
        node_postprocessors: list[BaseNodePostprocessor] = [rerank, page_pp]
    else:
        node_postprocessors = [TruncateNodesPostprocessor(top_n=cfg.rerank_top_n), page_pp]

    response_synthesizer = get_response_synthesizer(
        llm=llm,
        text_qa_template=_RULE_QA_TEMPLATE,
        response_mode=ResponseMode.SIMPLE_SUMMARIZE,
    )

    return RetrieverQueryEngine.from_args(
        retriever=retriever,
        node_postprocessors=node_postprocessors,
        response_synthesizer=response_synthesizer,
    )
