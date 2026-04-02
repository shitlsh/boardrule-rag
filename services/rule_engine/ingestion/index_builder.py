"""Per-game VectorStoreIndex + BM25 persistence; hybrid retrieval + cross-encoder rerank."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from llama_index.core import Settings, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core.postprocessor import SentenceTransformerRerank
from llama_index.core.schema import QueryBundle
from llama_index.embeddings.google_genai import GoogleGenAIEmbedding
from llama_index.retrievers.bm25 import BM25Retriever

from ingestion.hybrid_retriever import HybridFusionRetriever
from ingestion.node_builders import documents_to_nodes, merged_markdown_to_documents
from utils.paths import service_root

_MANIFEST_NAME = "manifest.json"
_VECTOR_SUBDIR = "vector_storage"
_BM25_SUBDIR = "bm25"


def _index_root() -> Path:
    raw = os.environ.get("INDEX_STORAGE_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    return service_root() / "data" / "indexes"


def game_index_dir(game_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in game_id.strip()) or "game"
    return _index_root() / safe


def _embedding_model_name() -> str:
    return os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")


def _rerank_model_name() -> str:
    return os.environ.get(
        "RERANK_MODEL",
        "cross-encoder/ms-marco-MiniLM-L-6-v2",
    )


def configure_embedding_settings() -> None:
    """Set global LlamaIndex embedding model (Gemini)."""
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set")
    Settings.embed_model = GoogleGenAIEmbedding(
        model_name=_embedding_model_name(),
        api_key=api_key,
    )


def build_and_persist_index(
    *,
    game_id: str,
    merged_markdown: str,
    source_file: str = "",
) -> dict[str, Any]:
    """
    Build per-game dense + BM25 indexes on disk.

    Metadata per node: game_id, source_file, pages, original_page_range, page_start, page_end.
    """
    configure_embedding_settings()
    root = game_index_dir(game_id)
    root.mkdir(parents=True, exist_ok=True)
    vec_dir = root / _VECTOR_SUBDIR
    bm25_dir = root / _BM25_SUBDIR

    docs = merged_markdown_to_documents(
        merged_markdown,
        game_id=game_id,
        source_file=source_file or "unknown",
    )
    nodes = documents_to_nodes(docs)
    if not nodes:
        raise ValueError("No nodes to index: empty merged_markdown or unchunkable content")

    # Fresh build: remove stale dirs
    import shutil

    if vec_dir.exists():
        shutil.rmtree(vec_dir)
    if bm25_dir.exists():
        shutil.rmtree(bm25_dir)

    index = VectorStoreIndex(nodes, show_progress=False)
    index.storage_context.persist(persist_dir=str(vec_dir))

    bm25 = BM25Retriever.from_defaults(nodes=nodes, similarity_top_k=12)
    bm25.persist(str(bm25_dir))

    manifest = {
        "schema_version": 1,
        "game_id": game_id,
        "source_file": source_file,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "embedding_model": _embedding_model_name(),
        "rerank_model": _rerank_model_name(),
        "node_count": len(nodes),
        "metadata_contract": [
            "game_id",
            "source_file",
            "pages",
            "original_page_range",
            "page_start",
            "page_end",
        ],
        "vector_storage": str(vec_dir),
        "bm25_storage": str(bm25_dir),
    }
    (root / _MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def load_manifest(game_id: str) -> dict[str, Any] | None:
    path = game_index_dir(game_id) / _MANIFEST_NAME
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_hybrid_reranked_nodes(
    game_id: str,
    query: str,
    *,
    similarity_top_k: int = 8,
    rerank_top_n: int = 5,
):
    """Load persisted index; hybrid BM25+dense + cross-encoder rerank (no LLM answer)."""
    configure_embedding_settings()
    root = game_index_dir(game_id)
    vec_dir = root / _VECTOR_SUBDIR
    if not vec_dir.is_dir():
        raise FileNotFoundError(f"No vector index at {vec_dir}")

    storage_context = StorageContext.from_defaults(persist_dir=str(vec_dir))
    index = load_index_from_storage(storage_context)

    bm25_dir = root / _BM25_SUBDIR
    bm25 = BM25Retriever.from_persist_dir(str(bm25_dir)) if bm25_dir.is_dir() else None
    if bm25 is None:
        raise FileNotFoundError(f"Missing BM25 persist dir at {bm25_dir}")

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
    bundle = QueryBundle(query_str=query)
    merged = hybrid.retrieve(bundle)
    return rerank.postprocess_nodes(merged, query_bundle=bundle)
