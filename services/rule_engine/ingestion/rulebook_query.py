"""LlamaIndex QueryEngine over hybrid + rerank for Phase 3 rulebook Q&A (decoupled from extraction)."""

from __future__ import annotations

from llama_index.core import Settings
from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.prompts import PromptTemplate
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.response_synthesizers import get_response_synthesizer
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from llama_index.llms.google_genai import GoogleGenAI
from ingestion.bm25_retriever import BoardruleBM25Retriever
from ingestion.hybrid_retriever import HybridFusionRetriever
from ingestion.node_builders import format_header_path_for_prompt
from ingestion.index_builder import _rerank_model_name, configure_embedding_settings, game_index_dir, load_vector_index
from ingestion.rerank_cache import get_cached_sentence_transformer_rerank
from utils.ai_gateway import get_gemini

_BM25_SUBDIR = "bm25"


def get_chat_llm() -> GoogleGenAI:
    c = get_gemini().chat
    return GoogleGenAI(
        model=c.model,
        api_key=c.api_key,
        temperature=float(c.temperature),
        max_tokens=int(c.max_tokens),
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
    bm25 = BoardruleBM25Retriever.from_persist_dir(str(bm25_dir))
    vector_retriever = index.as_retriever(similarity_top_k=similarity_top_k)
    hybrid = HybridFusionRetriever(
        bm25,
        vector_retriever,
        similarity_top_k=similarity_top_k,
    )
    rerank = get_cached_sentence_transformer_rerank(
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
