"""Per-game VectorStoreIndex + BM25 persistence; hybrid retrieval + cross-encoder rerank."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from llama_index.core import Document, Settings, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.postprocessor import SentenceTransformerRerank
from llama_index.core.schema import QueryBundle
from llama_index.embeddings.google_genai import GoogleGenAIEmbedding
from llama_index.retrievers.bm25 import BM25Retriever

from ingestion.hybrid_retriever import HybridFusionRetriever
from ingestion.node_builders import documents_to_nodes, merged_markdown_to_documents
from utils.ai_gateway import get_gemini
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
    return get_gemini().embed.model


def _rerank_model_name() -> str:
    return os.environ.get(
        "RERANK_MODEL",
        "cross-encoder/ms-marco-MiniLM-L-6-v2",
    )


def _embedding_dim() -> int:
    raw = os.environ.get("EMBEDDING_DIM", "3072").strip()
    return int(raw) if raw.isdigit() else 3072


def _pgvector_connection_string() -> str | None:
    raw = (os.environ.get("PGVECTOR_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if raw.startswith("postgresql"):
        return raw
    return None


def _use_pgvector_for_new_indexes() -> bool:
    if os.environ.get("USE_PGVECTOR", "").strip().lower() in ("0", "false", "no"):
        return False
    return _pgvector_connection_string() is not None


def _safe_table_name(game_id: str) -> str:
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in game_id.strip()) or "game"
    return f"li_{safe}"[:63]


def configure_embedding_settings() -> None:
    """Set global LlamaIndex embedding model (Gemini)."""
    g = get_gemini().embed
    Settings.embed_model = GoogleGenAIEmbedding(
        model_name=g.model,
        api_key=g.api_key,
    )


def _documents_from_inputs(
    *,
    merged_markdown: str | None,
    documents: list[Document] | None,
    game_id: str,
    source_file: str,
) -> list[Document]:
    if documents is not None:
        return documents
    if merged_markdown is None or not merged_markdown.strip():
        raise ValueError("Provide merged_markdown or documents")
    return merged_markdown_to_documents(
        merged_markdown,
        game_id=game_id,
        source_file=source_file or "unknown",
    )


def build_and_persist_index(
    *,
    game_id: str,
    merged_markdown: str | None = None,
    documents: list[Document] | None = None,
    source_file: str = "",
) -> dict[str, Any]:
    """
    Build per-game dense + BM25 indexes.

    Vectors: PostgreSQL + pgvector when `DATABASE_URL` / `PGVECTOR_DATABASE_URL` is set and
    `USE_PGVECTOR` is not disabled; otherwise SimpleVectorStore on disk under `vector_storage/`.
    """
    configure_embedding_settings()
    root = game_index_dir(game_id)
    root.mkdir(parents=True, exist_ok=True)
    vec_dir = root / _VECTOR_SUBDIR
    bm25_dir = root / _BM25_SUBDIR

    docs = _documents_from_inputs(
        merged_markdown=merged_markdown,
        documents=documents,
        game_id=game_id,
        source_file=source_file or "",
    )
    docs = [d for d in docs if (getattr(d, "text", None) or "").strip()]
    if not docs:
        raise ValueError(
            "No text to index after splitting merged Markdown. "
            "Ensure rules.md is non-empty and uses <!-- pages: N --> anchors as documented in EXTRACTION_FLOW.md."
        )

    nodes = documents_to_nodes(docs)
    if not nodes:
        # Rare: SentenceSplitter yields nothing on very short / odd tokenization; retry with one huge chunk.
        loose = SentenceSplitter(chunk_size=10_000_000, chunk_overlap=0)
        nodes = loose.get_nodes_from_documents(docs)
    if not nodes:
        raise ValueError(
            "Could not chunk merged Markdown for indexing. "
            "Check that sections contain visible text (not only HTML comments). "
            "Page anchors must look like <!-- pages: 3 --> or <!-- pages: 3-5 -->."
        )

    import shutil

    if bm25_dir.exists():
        shutil.rmtree(bm25_dir)
    if vec_dir.exists():
        shutil.rmtree(vec_dir)

    embed_dim = _embedding_dim()
    pg_uri = _pgvector_connection_string()
    use_pg = _use_pgvector_for_new_indexes() and pg_uri is not None

    if use_pg:
        from sqlalchemy import create_engine, text
        from llama_index.vector_stores.postgres import PGVectorStore

        table = _safe_table_name(game_id)
        engine = create_engine(pg_uri, future=True)
        with engine.connect() as conn:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
            conn.commit()

        vector_store = PGVectorStore.from_params(
            connection_string=pg_uri,
            table_name=table,
            embed_dim=embed_dim,
        )
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex(nodes, storage_context=storage_context, show_progress=False)
        _ = index  # persisted in PG
        vector_backend = "pgvector"
        pg_table = table
    else:
        index = VectorStoreIndex(nodes, show_progress=False)
        index.storage_context.persist(persist_dir=str(vec_dir))
        vector_backend = "disk"
        pg_table = None

    bm25 = BM25Retriever.from_defaults(nodes=nodes, similarity_top_k=12)
    bm25.persist(str(bm25_dir))

    manifest = {
        "schema_version": 2,
        "game_id": game_id,
        "source_file": source_file,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "embedding_model": _embedding_model_name(),
        "embedding_dim": embed_dim,
        "rerank_model": _rerank_model_name(),
        "node_count": len(nodes),
        "vector_backend": vector_backend,
        "pg_table": pg_table,
        "metadata_contract": [
            "game_id",
            "source_file",
            "pages",
            "original_page_range",
            "page_start",
            "page_end",
        ],
        "vector_storage": str(vec_dir) if vector_backend == "disk" else None,
        "bm25_storage": str(bm25_dir),
    }
    (root / _MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def load_manifest(game_id: str) -> dict[str, Any] | None:
    path = game_index_dir(game_id) / _MANIFEST_NAME
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_vector_index(game_id: str) -> VectorStoreIndex:
    """Load dense index from disk SimpleVectorStore or PostgreSQL pgvector."""
    configure_embedding_settings()
    manifest = load_manifest(game_id)
    if not manifest:
        raise FileNotFoundError(f"No index manifest for game_id={game_id}")

    backend = manifest.get("vector_backend") or "disk"
    if backend == "pgvector":
        pg_uri = _pgvector_connection_string()
        if not pg_uri:
            raise RuntimeError("Index uses pgvector but no PostgreSQL URL is configured")
        table = manifest.get("pg_table")
        if not table:
            raise RuntimeError("Manifest missing pg_table for pgvector index")
        embed_dim = int(manifest.get("embedding_dim") or _embedding_dim())
        from llama_index.vector_stores.postgres import PGVectorStore

        vector_store = PGVectorStore.from_params(
            connection_string=pg_uri,
            table_name=str(table),
            embed_dim=embed_dim,
            perform_setup=False,
        )
        return VectorStoreIndex.from_vector_store(vector_store)

    root = game_index_dir(game_id)
    vec_dir = root / _VECTOR_SUBDIR
    if not vec_dir.is_dir():
        raise FileNotFoundError(f"No vector index at {vec_dir}")
    storage_context = StorageContext.from_defaults(persist_dir=str(vec_dir))
    return load_index_from_storage(storage_context)


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
    bm25_dir = root / _BM25_SUBDIR
    if not bm25_dir.is_dir():
        raise FileNotFoundError(f"Missing BM25 persist dir at {bm25_dir}")

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
    bundle = QueryBundle(query_str=query)
    merged = hybrid.retrieve(bundle)
    return rerank.postprocess_nodes(merged, query_bundle=bundle)
