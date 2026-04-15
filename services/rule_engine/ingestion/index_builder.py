"""Per-game VectorStoreIndex + BM25 persistence; hybrid retrieval + cross-encoder rerank."""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from llama_index.core import Document, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core.schema import MetadataMode, NodeWithScore, QueryBundle, TextNode
from llama_index.embeddings.bedrock import BedrockEmbedding
from llama_index.embeddings.google_genai import GoogleGenAIEmbedding
from llama_index.embeddings.openai import OpenAIEmbedding

from ingestion.bm25_retriever import BM25_CJK_TOKEN_PATTERN, BoardruleBM25Retriever, default_bm25_from_nodes
from ingestion.hybrid_retriever import HybridFusionRetriever
from ingestion.node_builders import (
    documents_to_nodes,
    documents_to_nodes_loose,
    merged_markdown_to_documents,
    sanitize_invisible_unicode_for_rules_markdown,
)
from ingestion.jina_rerank import JinaRerankPostprocessor
from ingestion.rerank_cache import get_cached_sentence_transformer_rerank
from utils.ai_gateway import RerankSlotJina, RerankSlotLocal, get_rerank_slot, get_slots
from utils.retry import (
    INDEX_EMBED_RATE_LIMIT_ATTEMPTS,
    run_async_with_rate_limit_retry,
    run_with_rate_limit_retry,
)
from utils.dashscope_client import resolve_dashscope_api_base
from utils.openrouter_client import OPENROUTER_API_BASE
from utils.paths import service_root

JINA_API_BASE = "https://api.jina.ai/v1"

_MANIFEST_NAME = "manifest.json"
_VECTOR_SUBDIR = "vector_storage"
_BM25_SUBDIR = "bm25"

logger = logging.getLogger(__name__)


def _env_embed_batch_debug() -> bool:
    return os.environ.get("INDEX_BUILD_EMBED_BATCH_DEBUG", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _summarize_text_batch_for_embed_log(texts: list[str]) -> dict[str, int | float]:
    """Lightweight stats for diagnosing provider batch mismatches (no full text in logs)."""
    n = len(texts)
    if n == 0:
        return {"count": 0, "empty_strings": 0, "min_chars": 0, "max_chars": 0, "total_chars": 0}
    lens = [len(t) for t in texts]
    empty = sum(1 for t in texts if t == "")
    return {
        "count": n,
        "empty_strings": empty,
        "min_chars": min(lens),
        "max_chars": max(lens),
        "total_chars": sum(lens),
    }


def _log_embedding_batch_mismatch(
    *,
    sync: bool,
    texts: list[str],
    out_len: int,
    provider: str,
    model: str,
    embed_model: Any,
) -> None:
    stats = _summarize_text_batch_for_embed_log(texts)
    eb = getattr(embed_model, "embed_batch_size", None)
    nw = getattr(embed_model, "num_workers", None)
    previews: list[str] = []
    for i, t in enumerate(texts[:3]):
        s = repr(t[:120] + ("…" if len(t) > 120 else ""))
        previews.append(f"[{i}] len={len(t)} sample={s}")
    logger.error(
        "embedding batch length mismatch (%s): expected %s vectors, got %s; "
        "provider=%r model=%r embed_batch_size=%r num_workers=%r stats=%s; "
        "first texts: %s",
        "sync" if sync else "async",
        len(texts),
        out_len,
        provider,
        model,
        eb,
        nw,
        stats,
        " | ".join(previews) if previews else "(none)",
    )


def _attach_embedding_batch_diagnostics(
    embed_model: Any,
    *,
    provider: str,
    model: str,
) -> None:
    """
    Wrap batch embedding calls so we log dimensions and surface a clear error if the provider
    returns fewer vectors than texts (LlamaIndex ``embed_nodes`` would otherwise KeyError).
    """
    if getattr(embed_model, "_boardrule_embed_batch_diag", False):
        return
    # Pydantic embedding models (e.g. GoogleGenAIEmbedding) reject arbitrary attribute assignment;
    # bypass their __setattr__ so we can mark wrapped + replace batch methods.
    object.__setattr__(embed_model, "_boardrule_embed_batch_diag", True)

    debug = _env_embed_batch_debug()
    orig_batch = embed_model.get_text_embedding_batch
    orig_abatch = getattr(embed_model, "aget_text_embedding_batch", None)

    def get_text_embedding_batch(
        texts: list[str],
        show_progress: bool = False,
        **kwargs: Any,
    ) -> Any:
        if debug:
            logger.info(
                "embed batch (sync): n_texts=%s embed_batch_size=%r provider=%r model=%r",
                len(texts),
                getattr(embed_model, "embed_batch_size", None),
                provider,
                model,
            )
        out = run_with_rate_limit_retry(
            lambda: orig_batch(texts, show_progress=show_progress, **kwargs),
            attempts=INDEX_EMBED_RATE_LIMIT_ATTEMPTS,
        )
        if len(out) != len(texts):
            _log_embedding_batch_mismatch(
                sync=True,
                texts=texts,
                out_len=len(out),
                provider=provider,
                model=model,
                embed_model=embed_model,
            )
            raise RuntimeError(
                f"Embedding API returned {len(out)} vectors for {len(texts)} input texts "
                f"(provider={provider!r}, model={model!r}). "
                "This breaks LlamaIndex node id ↔ embedding alignment; see logs above."
            )
        return out

    object.__setattr__(embed_model, "get_text_embedding_batch", get_text_embedding_batch)

    if orig_abatch is not None:

        async def aget_text_embedding_batch(
            texts: list[str],
            show_progress: bool = False,
            **kwargs: Any,
        ) -> Any:
            if debug:
                logger.info(
                    "embed batch (async): n_texts=%s embed_batch_size=%r provider=%r model=%r",
                    len(texts),
                    getattr(embed_model, "embed_batch_size", None),
                    provider,
                    model,
                )
            async def _do_abatch() -> Any:
                return await orig_abatch(texts, show_progress=show_progress, **kwargs)

            out = await run_async_with_rate_limit_retry(
                _do_abatch,
                attempts=INDEX_EMBED_RATE_LIMIT_ATTEMPTS,
            )
            if len(out) != len(texts):
                _log_embedding_batch_mismatch(
                    sync=False,
                    texts=texts,
                    out_len=len(out),
                    provider=provider,
                    model=model,
                    embed_model=embed_model,
                )
                raise RuntimeError(
                    f"Embedding API returned {len(out)} vectors for {len(texts)} input texts "
                    f"(provider={provider!r}, model={model!r}). "
                    "This breaks LlamaIndex node id ↔ embedding alignment; see logs above."
                )
            return out

        object.__setattr__(embed_model, "aget_text_embedding_batch", aget_text_embedding_batch)


def _embed_text_for_indexing_filter(node: TextNode) -> str:
    raw = node.get_content(metadata_mode=MetadataMode.EMBED)
    if raw is None:
        return ""
    return sanitize_invisible_unicode_for_rules_markdown(str(raw)).strip()


def _nodes_with_embeddable_text(nodes: list[TextNode]) -> list[TextNode]:
    """Remove chunks that have no real text to embed (whitespace / zero-width only)."""
    import logging

    kept: list[TextNode] = []
    dropped = 0
    for n in nodes:
        if _embed_text_for_indexing_filter(n):
            kept.append(n)
        else:
            dropped += 1
    if dropped:
        logging.getLogger(__name__).warning(
            "index build dropped %s empty-looking chunk(s) (whitespace/zero-width only); kept %s",
            dropped,
            len(kept),
        )
    return kept


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


def _resolve_chunk_size_overlap_for_build(
    override_chunk_size: int | None,
    override_chunk_overlap: int | None,
) -> tuple[int, int]:
    """
    Effective chunking for one build: per-request overrides, else global ``_chunk_size_overlap()`` (env + gateway).

    Stored in manifest as ``chunk_size`` / ``chunk_overlap`` (query-time retrieval does not use these).
    """
    base_cs, base_co = _chunk_size_overlap()
    cs = base_cs if override_chunk_size is None else max(1, int(override_chunk_size))
    co = base_co if override_chunk_overlap is None else max(0, int(override_chunk_overlap))
    if co >= cs:
        co = max(0, cs // 2)
    return cs, co


def _bm25_token_pattern() -> str:
    ro = _try_rag_options()
    if ro is not None and ro.bm25_token_profile == "latin_word":
        return r"(?u)\b\w\w+\b"
    return BM25_CJK_TOKEN_PATTERN


def _env_similarity_top_k() -> int:
    try:
        v = int(os.environ.get("RAG_SIMILARITY_TOP_K", "8"))
        return max(1, min(200, v))
    except ValueError:
        return 8


def _env_rerank_top_n() -> int:
    try:
        v = int(os.environ.get("RAG_RERANK_TOP_N", "5"))
        return max(1, min(100, v))
    except ValueError:
        return 5


def _env_retrieval_mode() -> Literal["hybrid", "vector_only"]:
    v = (os.environ.get("RAG_RETRIEVAL_MODE") or "hybrid").strip().lower()
    if v == "vector_only":
        return "vector_only"
    return "hybrid"


def _env_use_rerank() -> bool:
    return os.environ.get("RAG_USE_RERANK", "true").strip().lower() not in ("0", "false", "no")


@dataclass(frozen=True)
class RetrievalConfig:
    """Per-index retrieval behavior (persisted in manifest, read at query time)."""

    similarity_top_k: int
    rerank_top_n: int
    retrieval_mode: Literal["hybrid", "vector_only"]
    use_rerank: bool


def retrieval_config_from_manifest(manifest: dict[str, Any]) -> RetrievalConfig:
    """Defaults match pre-manifest behavior: hybrid, rerank on, top_k=8, rerank_n=5."""
    mode_raw = manifest.get("retrieval_mode") or "hybrid"
    mode: Literal["hybrid", "vector_only"] = (
        "vector_only" if mode_raw == "vector_only" else "hybrid"
    )
    ur_raw = manifest.get("use_rerank")
    use_r = True if ur_raw is None else bool(ur_raw)
    try:
        sk = int(manifest["similarity_top_k"]) if manifest.get("similarity_top_k") is not None else _env_similarity_top_k()
    except (TypeError, ValueError):
        sk = _env_similarity_top_k()
    sk = max(1, min(200, sk))
    try:
        rrn = int(manifest["rerank_top_n"]) if manifest.get("rerank_top_n") is not None else _env_rerank_top_n()
    except (TypeError, ValueError):
        rrn = _env_rerank_top_n()
    rrn = max(1, min(100, rrn))
    return RetrievalConfig(
        similarity_top_k=sk,
        rerank_top_n=rrn,
        retrieval_mode=mode,
        use_rerank=use_r,
    )


def _resolve_retrieval_for_build(
    explicit_sk: int | None,
    explicit_rrn: int | None,
    explicit_mode: str | None,
    explicit_ur: bool | None,
) -> tuple[int, int, Literal["hybrid", "vector_only"], bool]:
    """
    Precedence: explicit build args > AI Gateway ``ragOptions`` > process env > built-in default.

    Query-time behavior is always taken from the manifest written at build time.
    """
    ro = _try_rag_options()
    sk = explicit_sk
    if sk is None and ro is not None and ro.similarity_top_k is not None:
        sk = ro.similarity_top_k
    if sk is None:
        sk = _env_similarity_top_k()
    sk = max(1, min(200, int(sk)))

    rrn = explicit_rrn
    if rrn is None and ro is not None and ro.rerank_top_n is not None:
        rrn = ro.rerank_top_n
    if rrn is None:
        rrn = _env_rerank_top_n()
    rrn = max(1, min(100, int(rrn)))

    mode: str | None = explicit_mode
    if mode is None and ro is not None and ro.retrieval_mode is not None:
        mode = ro.retrieval_mode
    if mode is None:
        mode = _env_retrieval_mode()
    if mode not in ("hybrid", "vector_only"):
        mode = "hybrid"
    mode_t: Literal["hybrid", "vector_only"] = mode  # type: ignore[assignment]

    ur = explicit_ur
    if ur is None and ro is not None and ro.use_rerank is not None:
        ur = ro.use_rerank
    if ur is None:
        ur = _env_use_rerank()
    return sk, rrn, mode_t, ur


def _index_root() -> Path:
    raw = os.environ.get("INDEX_STORAGE_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    return service_root() / "data" / "indexes"


def game_index_dir(game_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in game_id.strip()) or "game"
    return _index_root() / safe


def _embedding_model_name() -> str:
    return get_slots().embed.model


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


def _effective_local_rerank_hf_name() -> str:
    """HF cross-encoder id for local rerank (slot, then ragOptions, then env)."""
    s = get_rerank_slot()
    if isinstance(s, RerankSlotLocal):
        return s.model.strip()
    ro = _try_rag_options()
    if ro is not None and ro.rerank_model and str(ro.rerank_model).strip():
        return str(ro.rerank_model).strip()
    return os.environ.get("RERANK_MODEL", _DEFAULT_RERANK_MODEL)


def _rerank_model_name() -> str:
    """Backward-compatible name for manifest / local SentenceTransformer id."""
    return _effective_local_rerank_hf_name()


def _manifest_rerank_backend() -> Literal["local", "jina"]:
    s = get_rerank_slot()
    if isinstance(s, RerankSlotJina):
        return "jina"
    return "local"


def _manifest_rerank_model_id() -> str:
    s = get_rerank_slot()
    if isinstance(s, RerankSlotJina):
        return s.model.strip()
    if isinstance(s, RerankSlotLocal):
        return s.model.strip()
    return _effective_local_rerank_hf_name()


def _embedding_dim() -> int:
    raw = (os.environ.get("EMBEDDING_DIM") or "3072").strip().lower()
    if raw in ("", "none", "null") or not raw.isdigit():
        return 3072
    return int(raw)


def _gemini_google_genai_embed_retry_kwargs() -> dict[str, Any]:
    """
    LlamaIndex ``GoogleGenAIEmbedding`` has its own tenacity retries (default 3×, 1–60s).
    For free-tier Gemini RPM, bump inner retries + longer waits; override with env if needed.
    """
    raw_r = (os.environ.get("GEMINI_EMBED_RETRIES") or "12").strip()
    raw_min = (os.environ.get("GEMINI_EMBED_RETRY_MIN_SECONDS") or "8").strip()
    raw_max = (os.environ.get("GEMINI_EMBED_RETRY_MAX_SECONDS") or "120").strip()
    try:
        retries = int(raw_r)
    except ValueError:
        retries = 12
    try:
        retry_min = float(raw_min)
    except ValueError:
        retry_min = 8.0
    try:
        retry_max = float(raw_max)
    except ValueError:
        retry_max = 120.0
    retries = max(1, min(32, retries))
    retry_min = max(1.0, retry_min)
    retry_max = max(retry_min, retry_max)
    return {
        "retries": retries,
        "retry_min_seconds": retry_min,
        "retry_max_seconds": retry_max,
    }


def _gemini_embed_batch_size() -> int:
    """
    LlamaIndex's ``BaseEmbedding.get_text_embedding_batch`` flushes in chunks of ``embed_batch_size``.
    For ``gemini-embedding-2*``, ``batchEmbedContents`` often returns **one** embedding object per
    HTTP call regardless of how many texts were sent, so a chunk of 10 yields 1 vector and breaks
    ``embed_nodes`` (zip length mismatch / KeyError). Per-text requests keep a 1:1 mapping.

    Override with env ``GEMINI_EMBED_BATCH_SIZE`` (integer ≥ 1) if a future SDK/API fixes batching.
    """
    raw = (os.environ.get("GEMINI_EMBED_BATCH_SIZE") or "1").strip()
    try:
        n = int(raw)
    except ValueError:
        return 1
    return max(1, min(100, n))


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
    """LlamaIndex PGVectorStore uses ``DATABASE_URL`` when it is a Postgres DSN."""
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    if raw.startswith("postgresql"):
        return _sanitize_postgresql_dsn(raw)
    return None


def _safe_table_name(game_id: str) -> str:
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in game_id.strip()) or "game"
    return f"li_{safe}"[:63]


def _pgvector_physical_table_name(game_id: str) -> str:
    """
    Actual PostgreSQL table created by LlamaIndex ``PGVectorStore``.

    The store lowercases the logical ``table_name`` and builds the model as
    ``data_{index_name}`` (see ``llama_index.vector_stores.postgres.get_data_model``).
    Manifest still stores the logical name (``li_<game_id>``); vectors live in ``data_li_...``.
    """
    logical = _safe_table_name(game_id).lower()
    return f"data_{logical}"


def build_embedding_model() -> GoogleGenAIEmbedding | OpenAIEmbedding | BedrockEmbedding:
    """Construct and return a per-request embedding model from the Embed slot.

    Returns a fresh model instance every call — **never** touches the global
    ``llama_index.core.Settings`` singleton, making concurrent requests with
    different providers safe.
    """
    slot = get_slots().embed
    if slot.provider == "jina":
        embed_model: GoogleGenAIEmbedding | OpenAIEmbedding | BedrockEmbedding = OpenAIEmbedding(
            model=slot.model,
            api_key=slot.api_key,
            api_base=JINA_API_BASE,
        )
    elif slot.provider == "openrouter":
        embed_model = OpenAIEmbedding(
            model=slot.model,
            api_key=slot.api_key,
            api_base=OPENROUTER_API_BASE,
        )
    elif slot.provider == "qwen":
        embed_model = OpenAIEmbedding(
            model=slot.model,
            api_key=slot.api_key,
            api_base=resolve_dashscope_api_base(slot.dashscope_compatible_base),
        )
    elif slot.provider == "bedrock":
        rn = (slot.bedrock_region or "").strip()
        mode = slot.bedrock_auth_mode
        if not rn or mode not in ("iam", "api_key"):
            raise ValueError("Embed slot: Bedrock requires bedrockRegion and bedrockAuthMode (iam | api_key)")
        if mode == "iam":
            aid = (slot.aws_access_key_id or "").strip()
            if not aid:
                raise ValueError("Embed slot: Bedrock IAM requires awsAccessKeyId")
            embed_model = BedrockEmbedding(
                model_name=slot.model,
                region_name=rn,
                aws_access_key_id=aid,
                aws_secret_access_key=slot.api_key,
                aws_session_token=slot.aws_session_token,
            )
        else:
            # api_key mode: pass bearer token directly as aws_secret_access_key so we
            # never mutate the process-global os.environ (thread-safety).
            embed_model = BedrockEmbedding(
                model_name=slot.model,
                region_name=rn,
                aws_secret_access_key=slot.api_key,
            )
    else:
        embed_model = GoogleGenAIEmbedding(
            model_name=slot.model,
            api_key=slot.api_key,
            embed_batch_size=_gemini_embed_batch_size(),
            **_gemini_google_genai_embed_retry_kwargs(),
        )
    _attach_embedding_batch_diagnostics(embed_model, provider=slot.provider, model=slot.model)
    return embed_model


# ---------------------------------------------------------------------------
# Backward-compatible alias so external callers that import the old name keep
# working while we migrate them.  New code should call build_embedding_model().
# ---------------------------------------------------------------------------
def configure_embedding_settings() -> None:
    """Deprecated: sets global Settings.embed_model. Use build_embedding_model() instead."""
    from llama_index.core import Settings

    Settings.embed_model = build_embedding_model()


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
    similarity_top_k: int | None = None,
    rerank_top_n: int | None = None,
    retrieval_mode: Literal["hybrid", "vector_only"] | None = None,
    use_rerank: bool | None = None,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> dict[str, Any]:
    """
    Build per-game dense index; optionally persist BM25 for hybrid retrieval.

    ``retrieval_mode=vector_only`` skips BM25 (smaller footprint). To enable hybrid later, rebuild
    with ``hybrid``. Rerank is query-only (no rebuild to toggle if manifest is updated—by default
    it is fixed at build time from these parameters).

    Vectors: PostgreSQL + pgvector when `DATABASE_URL` is a `postgresql://` DSN; otherwise
    SimpleVectorStore on disk under `vector_storage/`.
    """
    sk, rrn, mode, use_rr = _resolve_retrieval_for_build(
        similarity_top_k,
        rerank_top_n,
        retrieval_mode,
        use_rerank,
    )
    embed_model = build_embedding_model()
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

    chunk_size, chunk_overlap = _resolve_chunk_size_overlap_for_build(chunk_size, chunk_overlap)
    nodes = documents_to_nodes(docs, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    if not nodes:
        nodes = documents_to_nodes_loose(docs)
    nodes = _nodes_with_embeddable_text(nodes)
    if not nodes:
        raise ValueError(
            "Could not chunk merged Markdown for indexing. "
            "Check that sections contain visible text (not only HTML comments). "
            "Page anchors must look like <!-- pages: 3 --> or <!-- pages: 3-5 -->."
        )

    slot = get_slots().embed
    logger.info(
        "index build: game_id=%s nodes=%s chunk_size=%s chunk_overlap=%s "
        "embed_provider=%s embed_model=%s pgvector=%s",
        game_id,
        len(nodes),
        chunk_size,
        chunk_overlap,
        slot.provider,
        slot.model,
        _pgvector_connection_string() is not None,
    )

    import shutil

    if bm25_dir.exists():
        shutil.rmtree(bm25_dir)
    if vec_dir.exists():
        shutil.rmtree(vec_dir)

    embed_dim = _embedding_dim()
    pg_uri = _pgvector_connection_string()
    use_pg = pg_uri is not None

    if use_pg:
        from sqlalchemy import create_engine, text
        from llama_index.vector_stores.postgres import PGVectorStore

        table = _safe_table_name(game_id)
        physical = _pgvector_physical_table_name(game_id)
        sync_uri, async_uri = _paired_pgvector_uris(pg_uri)
        engine = create_engine(sync_uri, future=True)
        with engine.connect() as conn:
            # Must match LlamaIndex table name ``data_{logical_name}``; dropping only ``li_*`` misses
            # the real table and rebuilds append rows (duplicate vectors / doubled counts).
            conn.execute(text(f'DROP TABLE IF EXISTS public."{physical}" CASCADE'))
            # Legacy mistake: older builds used the wrong name here; remove empty orphan if any.
            conn.execute(text(f'DROP TABLE IF EXISTS public."{table.lower()}" CASCADE'))
            conn.commit()

        vector_store = PGVectorStore.from_params(
            connection_string=sync_uri,
            async_connection_string=async_uri,
            table_name=table,
            embed_dim=embed_dim,
        )
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        index = VectorStoreIndex(nodes, storage_context=storage_context, embed_model=embed_model, show_progress=False)
        _ = index  # persisted in PG
        vector_backend = "pgvector"
        pg_table = table
    else:
        index = VectorStoreIndex(nodes, embed_model=embed_model, show_progress=False)
        index.storage_context.persist(persist_dir=str(vec_dir))
        vector_backend = "disk"
        pg_table = None

    bm25_path: str | None = None
    if mode == "hybrid":
        bm25 = default_bm25_from_nodes(
            nodes,
            similarity_top_k=sk,
            token_pattern=_bm25_token_pattern(),
        )
        bm25.persist(str(bm25_dir))
        bm25_path = str(bm25_dir)

    manifest = {
        "schema_version": 3,
        "game_id": game_id,
        "source_file": source_file,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "embedding_model": _embedding_model_name(),
        "embedding_dim": embed_dim,
        "rerank_backend": _manifest_rerank_backend(),
        "rerank_model": _manifest_rerank_model_id(),
        "node_count": len(nodes),
        "vector_backend": vector_backend,
        "pg_table": pg_table,
        "similarity_top_k": sk,
        "rerank_top_n": rrn,
        "retrieval_mode": mode,
        "use_rerank": use_rr,
        "chunk_size": chunk_size,
        "chunk_overlap": chunk_overlap,
        "metadata_contract": [
            "game_id",
            "source_file",
            "pages",
            "original_page_range",
            "page_start",
            "page_end",
            "header_path",
            "similarity_top_k",
            "rerank_top_n",
            "retrieval_mode",
            "use_rerank",
            "chunk_size",
            "chunk_overlap",
        ],
        "vector_storage": str(vec_dir) if vector_backend == "disk" else None,
        "bm25_storage": bm25_path,
    }
    (root / _MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    from ingestion.index_storage_remote import upload_game_index_bundle_after_build

    upload_game_index_bundle_after_build(game_id, root)
    return manifest


def load_manifest(game_id: str) -> dict[str, Any] | None:
    from ingestion.index_storage_remote import ensure_game_index_local

    ensure_game_index_local(game_id)
    path = game_index_dir(game_id) / _MANIFEST_NAME
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_vector_index(
    game_id: str,
    *,
    embed_model: GoogleGenAIEmbedding | OpenAIEmbedding | BedrockEmbedding | None = None,
) -> VectorStoreIndex:
    """Load dense index from disk SimpleVectorStore or PostgreSQL pgvector.

    Pass ``embed_model`` (from :func:`build_embedding_model`) to avoid touching the global
    ``Settings`` singleton.  When omitted the deprecated ``configure_embedding_settings()``
    fallback is used for backward compatibility.
    """
    if embed_model is None:
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
        return VectorStoreIndex.from_vector_store(vector_store, embed_model=embed_model)

    root = game_index_dir(game_id)
    vec_dir = root / _VECTOR_SUBDIR
    if not vec_dir.is_dir():
        raise FileNotFoundError(f"No vector index at {vec_dir}")
    storage_context = StorageContext.from_defaults(persist_dir=str(vec_dir))
    return load_index_from_storage(storage_context, embed_model=embed_model)


def load_hybrid_reranked_nodes(
    game_id: str,
    query: str,
    *,
    similarity_top_k: int | None = None,
    rerank_top_n: int | None = None,
) -> list[NodeWithScore]:
    """
    Retrieve nodes for a query using per-index settings from ``manifest.json``.

    Optional ``similarity_top_k`` / ``rerank_top_n`` override manifest (for tests only); production
    callers should omit them so the index controls behavior.
    """
    manifest = load_manifest(game_id)
    if not manifest:
        raise FileNotFoundError(f"No index manifest for game_id={game_id}")
    cfg = retrieval_config_from_manifest(manifest)
    sk = cfg.similarity_top_k if similarity_top_k is None else max(1, min(200, int(similarity_top_k)))
    rrn = cfg.rerank_top_n if rerank_top_n is None else max(1, min(100, int(rerank_top_n)))

    embed_model = build_embedding_model()
    index = load_vector_index(game_id, embed_model=embed_model)
    bundle = QueryBundle(query_str=query)
    vector_retriever = index.as_retriever(similarity_top_k=sk)

    if cfg.retrieval_mode == "vector_only":
        merged = vector_retriever.retrieve(bundle)
    else:
        root = game_index_dir(game_id)
        bm25_dir = root / _BM25_SUBDIR
        if not bm25_dir.is_dir():
            raise FileNotFoundError(
                "Hybrid retrieval requires BM25 data under the index directory. "
                "Rebuild with retrieval mode «hybrid» (vector-only indexes omit BM25)."
            )
        bm25 = BoardruleBM25Retriever.from_persist_dir(str(bm25_dir))
        hybrid = HybridFusionRetriever(
            bm25,
            vector_retriever,
            similarity_top_k=sk,
        )
        merged = hybrid.retrieve(bundle)

    if not cfg.use_rerank:
        return merged[:rrn]

    rs = get_rerank_slot()
    if isinstance(rs, RerankSlotJina):
        jr = JinaRerankPostprocessor(api_key=rs.api_key, model=rs.model, top_n=rrn)
        return jr.postprocess_nodes(merged, query_bundle=bundle)

    hf = _effective_local_rerank_hf_name()
    rerank = get_cached_sentence_transformer_rerank(
        model=hf,
        top_n=rrn,
    )
    return rerank.postprocess_nodes(merged, query_bundle=bundle)
