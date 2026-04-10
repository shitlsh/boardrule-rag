"""DSN helpers for pgvector / SQLAlchemy."""

import asyncio

import pytest

from ingestion.index_builder import (
    _attach_embedding_batch_diagnostics,
    _embedding_models_equivalent,
    _nodes_with_embeddable_text,
    _normalize_embedding_model_id,
    _paired_pgvector_uris,
    _pgvector_physical_table_name,
    _safe_table_name,
    _sanitize_postgresql_dsn,
    _summarize_text_batch_for_embed_log,
)


def test_sanitize_strips_literal_none_port() -> None:
    raw = "postgresql://postgres:postgres@127.0.0.1:None/postgres"
    out = _sanitize_postgresql_dsn(raw)
    assert ":None" not in out
    assert "127.0.0.1/postgres" in out


def test_sanitize_leaves_normal_port() -> None:
    u = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    assert _sanitize_postgresql_dsn(u) == u


def test_normalize_embedding_model_id_strips_models_prefix() -> None:
    assert _normalize_embedding_model_id("models/text-embedding-004") == _normalize_embedding_model_id(
        "text-embedding-004"
    )


def test_embedding_models_equivalent() -> None:
    assert _embedding_models_equivalent("models/foo", "foo") is True
    assert _embedding_models_equivalent("models/a", "models/b") is False


def test_pgvector_physical_table_is_data_prefix_plus_logical() -> None:
    """LlamaIndex stores rows in ``data_{logical}``, not ``logical`` alone."""
    gid = "cmnq3i2eh000aksjrprpoiyoj"
    assert _pgvector_physical_table_name(gid) == f"data_{_safe_table_name(gid).lower()}"


def test_nodes_with_embeddable_text_drops_invisible_only_chunks() -> None:
    """LlamaIndex keeps whitespace/ZW chunks; embedding APIs may omit them → KeyError in embed_nodes."""
    from llama_index.core.schema import TextNode

    good = TextNode(text="visible")
    bad = TextNode(text=" \u200b \ufeff ")
    out = _nodes_with_embeddable_text([good, bad])
    assert len(out) == 1
    assert out[0].node_id == good.node_id


def test_paired_uris_for_plain_postgresql() -> None:
    dsn = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    sync, async_ = _paired_pgvector_uris(dsn)
    assert sync.startswith("postgresql+psycopg2://")
    assert async_.startswith("postgresql+asyncpg://")
    assert sync.endswith("127.0.0.1:54322/postgres")
    assert async_.endswith("127.0.0.1:54322/postgres")


def test_summarize_text_batch_for_embed_log() -> None:
    s = _summarize_text_batch_for_embed_log(["a", "", "bc"])
    assert s["count"] == 3
    assert s["empty_strings"] == 1
    assert s["min_chars"] == 0
    assert s["max_chars"] == 2


def test_embedding_batch_diagnostics_raises_on_short_response() -> None:
    """Mirrors LlamaIndex failure when ``get_text_embedding_batch`` returns too few vectors."""

    class BadEmbed:
        embed_batch_size = 512

        def get_text_embedding_batch(self, texts, show_progress=False, **kwargs):
            return [[0.0, 0.0]] * (len(texts) - 1)

        async def aget_text_embedding_batch(self, texts, show_progress=False, **kwargs):
            return [[0.0, 0.0]] * (len(texts) - 1)

    bad = BadEmbed()
    _attach_embedding_batch_diagnostics(bad, provider="gemini", model="text-embedding-004")
    with pytest.raises(RuntimeError, match="Embedding API returned"):
        bad.get_text_embedding_batch(["x", "y"])

    async def _run() -> None:
        with pytest.raises(RuntimeError, match="Embedding API returned"):
            await bad.aget_text_embedding_batch(["x", "y"])

    asyncio.run(_run())
