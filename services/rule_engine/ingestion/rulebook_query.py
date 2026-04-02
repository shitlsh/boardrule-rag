"""LlamaIndex QueryEngine over hybrid + rerank for Phase 3 rulebook Q&A (decoupled from extraction)."""

from __future__ import annotations

import os

from llama_index.core import Settings
from llama_index.core.postprocessor import SentenceTransformerRerank
from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.prompts import PromptTemplate
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.response_synthesizers import get_response_synthesizer
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from llama_index.llms.google_genai import GoogleGenAI
from llama_index.retrievers.bm25 import BM25Retriever

from ingestion.hybrid_retriever import HybridFusionRetriever
from ingestion.index_builder import _rerank_model_name, configure_embedding_settings, game_index_dir, load_vector_index

_BM25_SUBDIR = "bm25"


def _chat_model_name() -> str:
    return os.environ.get(
        "GEMINI_CHAT_MODEL",
        os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.0-flash"),
    )


def get_chat_llm() -> GoogleGenAI:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")
    return GoogleGenAI(
        model=_chat_model_name(),
        api_key=api_key,
        temperature=float(os.environ.get("GEMINI_CHAT_TEMPERATURE", "0.2")),
        max_tokens=int(os.environ.get("GEMINI_CHAT_MAX_TOKENS", "8192")),
    )


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
            prefix = f"[页码: {pages}]\n" if pages else ""
            body = node.get_content() if hasattr(node, "get_content") else str(getattr(node, "text", ""))
            new_node = TextNode(
                text=prefix + body,
                metadata=meta,
                id_=node.node_id,
            )
            out.append(NodeWithScore(node=new_node, score=nws.score))
        return out


_RULE_QA_TEMPLATE = PromptTemplate(
    "你是桌游规则助手。仅根据下方「上下文」回答，使用简体中文。\n"
    "若上下文不足以回答，请明确说明「规则书中未找到相关说明」。\n"
    "回答中请在相关句子旁标注页码（沿用上下文中的页码范围）。\n\n"
    "上下文：\n"
    "---------------------\n"
    "{context_str}\n"
    "---------------------\n"
    "问题：{query_str}\n"
    "回答："
)


def build_rulebook_query_engine(
    game_id: str,
    *,
    similarity_top_k: int = 8,
    rerank_top_n: int = 5,
) -> RetrieverQueryEngine:
    """Hybrid BM25 + dense, cross-encoder rerank, Gemini synthesis (same stack as smoke-retrieve + LLM)."""
    configure_embedding_settings()
    llm = get_chat_llm()
    Settings.llm = llm

    root = game_index_dir(game_id)
    bm25_dir = root / _BM25_SUBDIR
    if not bm25_dir.is_dir():
        raise FileNotFoundError(f"Missing BM25 persist dir at {bm25_dir}")

    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"No index manifest for game_id={game_id}")

    index = load_vector_index(game_id)
    bm25 = BM25Retriever.from_persist_dir(str(bm25_dir))
    vector_retriever = index.as_retriever(similarity_top_k=similarity_top_k)
    hybrid = HybridFusionRetriever(
        bm25,
        vector_retriever,
        similarity_top_k=similarity_top_k,
    )
    rerank = SentenceTransformerRerank(
        model=_rerank_model_name(),
        top_n=rerank_top_n,
    )
    page_pp = PageMetadataPrefixPostprocessor()

    response_synthesizer = get_response_synthesizer(
        llm=llm,
        text_qa_template=_RULE_QA_TEMPLATE,
        response_mode="compact",
    )

    return RetrieverQueryEngine.from_args(
        retriever=hybrid,
        node_postprocessors=[rerank, page_pp],
        response_synthesizer=response_synthesizer,
    )
