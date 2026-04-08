"""Per-game VectorStoreIndex + BM25 persistence; hybrid retrieval + cross-encoder rerank."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from llama_index.core import Document, Settings, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core.schema import QueryBundle
from llama_index.embeddings.google_genai import GoogleGenAIEmbedding

from ingestion.bm25_retriever import BM25_CJK_TOKEN_PATTERN, BoardruleBM25Retriever, default_bm25_from_nodes
from ingestion.hybrid_retriever import HybridFusionRetriever
from ingestion.node_builders import documents_to_nodes, documents_to_nodes_loose, merged_markdown_to_documents
from ingestion.rerank_cache import get_cached_sentence_transformer_rerank
from utils.ai_gateway import get_gemini
from utils.paths import service_root

_MANIFEST_NAME = "manifest.json"
_VECTOR_SUBDIR = "vector_storage"
_BM25_SUBDIR = "bm25"

# Multilingual cross-encoder; stronger than MiniLM variants for zh/en retrieval reranking.
_DEFAULT_RERANK_MODEL = "BAAI/bge-reranker-base"


def _try_rag_options():
    try:
        from utils.ai_gateway import get_config

        return get_config().rag_options
    except RuntimeError:
        return None


def _chunk_size_overlap() -> tuple[int, int]:
    ro = _try_rag_options()
    cs = int(os.environ.get("CHUNK_SIZE", "1024"))
    co = int(os.environ.get("CHUNK_OVERLAP", "128"))
    if ro is not None:
        if ro.chunk_size is not None:
            cs = ro.chunk_size
        if ro.chunk_overlap is not None:
            co = ro.chunk_overlap
    if cs < 1:
        cs = 1024
    if co < 0:
        co = 0
    if co >= cs:
        co = max(0, cs // 2)
    return cs, co


def _bm25_token_pattern() -> str:
    ro = _try_rag_options()
    if ro is not None and ro.bm25_token_profile == "latin_word":
        return r"(?u)\b\w\w+\b"
    return BM25_CJK_TOKEN_PATTERN


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


def _normalize_embedding_model_id(model_id: str) -> str:
    """Compare Gemini model ids whether or not the ``models/`` prefix is present."""
    t = model_id.strip()
    if t.startswith("models/"):
        return t[len("models/") :].lower()
    return t.lower()


def _embedding_models_equivalent(stored: str | None, current: str) -> bool:
    if not stored or not str(stored).strip():
        return True
    return _normalize_embedding_model_id(str(stored)) == _normalize_embedding_model_id(current)


def _require_query_embedding_matches_manifest(manifest: dict[str, Any]) -> None:
    """
    Dense retrieval must embed the query with the same model that produced index vectors.

    The manifest records the model used at build time; mismatch yields meaningless similarity scores.
    """
    stored = manifest.get("embedding_model")
    if not stored or not str(stored).strip():
        return
    current = _embedding_model_name()
    if not _embedding_models_equivalent(str(stored), current):
        raise RuntimeError(
            f"Embedding model mismatch: index was built with {stored!r}, "
            f"but the current AI Gateway Embed slot is {current!r}. "
            "Rebuild the index after changing the embedding model, or restore the same Embed model id."
        )


def _rerank_model_name() -> str:
    ro = _try_rag_options()
    if ro is not None and ro.rerank_model and str(ro.rerank_model).strip():
        return str(ro.rerank_model).strip()
    return os.environ.get("RERANK_MODEL", _DEFAULT_RERANK_MODEL)


def _embedding_dim() -> int:
    raw = (os.environ.get("EMBEDDING_DIM") or "3072").strip().lower()
    if raw in ("", "none", "null") or not raw.isdigit():
        return 3072
    return int(raw)


def _sanitize_postgresql_dsn(url: str) -> str:
    """
    SQLAlchemy rejects URLs where the port was serialized as the literal string ``None``
    (e.g. ``...@host:None/db`` → ``int('None')``). Strip that bogus segment.
    """
    t = url.strip()
    if ":None" not in t and ":none" not in t:
        return t
    return re.sub(r":[Nn]one(?=/|\?|#|$)", "", t, count=1)


def _paired_pgvector_uris(dsn: str) -> tuple[str, str]:
    """
    LlamaIndex ``PGVectorStore.from_params`` builds ``async_connection_string`` from host/user/port
    kwargs when ``async_connection_string`` is omitted; those default to None and produce
    ``postgresql+asyncpg://None:None@None:None/None``, which fails with ``int('None')`` on connect.

    Return explicit (sync_sqlalchemy_uri, async_sqlalchemy_uri) with the same netloc/path/query.
    """
    s = _sanitize_postgresql_dsn(dsn.strip())
    if not s.startswith("postgresql"):
        return s, s
    if s.startswith("postgresql+psycopg2://"):
        rest = s.split("postgresql+psycopg2://", 1)[1]
        return s, f"postgresql+asyncpg://{rest}"
    if s.startswith("postgresql+asyncpg://"):
        rest = s.split("postgresql+asyncpg://", 1)[1]
        return f"postgresql+psycopg2://{rest}", s
    # ``postgresql://`` — split once; keep query/fragment
    if s.startswith("postgresql://"):
        rest = s[len("postgresql://") :]
        return f"postgresql+psycopg2://{rest}", f"postgresql+asyncpg://{rest}"
    return s, s


def _pgvector_connection_string() -> str | None:
    raw = (os.environ.get("PGVECTOR_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if raw.startswith("postgresql"):
        return _sanitize_postgresql_dsn(raw)
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

    chunk_size, chunk_overlap = _chunk_size_overlap()
    nodes = documents_to_nodes(docs, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    if not nodes:
        nodes = documents_to_nodes_loose(docs)
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
        sync_uri, async_uri = _paired_pgvector_uris(pg_uri)
        engine = create_engine(sync_uri, future=True)
        with engine.connect() as conn:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
            conn.commit()

        vector_store = PGVectorStore.from_params(
            connection_string=sync_uri,
            async_connection_string=async_uri,
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

    bm25 = default_bm25_from_nodes(
        nodes,
        similarity_top_k=12,
        token_pattern=_bm25_token_pattern(),
    )
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
            "header_path",
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

    _require_query_embedding_matches_manifest(manifest)

    backend = manifest.get("vector_backend") or "disk"
    if backend == "pgvector":
        pg_uri = _pgvector_connection_string()
        if not pg_uri:
            raise RuntimeError("Index uses pgvector but no PostgreSQL URL is configured")
        table = manifest.get("pg_table")
        if not table:
            raise RuntimeError("Manifest missing pg_table for pgvector index")
        raw_ed = manifest.get("embedding_dim")
        if raw_ed is None or str(raw_ed).strip().lower() in ("none", "null", ""):
            embed_dim = _embedding_dim()
        else:
            embed_dim = int(raw_ed) if str(raw_ed).strip().isdigit() else _embedding_dim()
        from llama_index.vector_stores.postgres import PGVectorStore

        sync_uri, async_uri = _paired_pgvector_uris(pg_uri)
        vector_store = PGVectorStore.from_params(
            connection_string=sync_uri,
            async_connection_string=async_uri,
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
    bundle = QueryBundle(query_str=query)
    merged = hybrid.retrieve(bundle)
    return rerank.postprocess_nodes(merged, query_bundle=bundle)
