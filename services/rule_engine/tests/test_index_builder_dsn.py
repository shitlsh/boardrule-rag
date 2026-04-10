"""DSN helpers for pgvector / SQLAlchemy."""

from ingestion.index_builder import (
    _embedding_models_equivalent,
    _nodes_with_embeddable_text,
    _normalize_embedding_model_id,
    _paired_pgvector_uris,
    _pgvector_physical_table_name,
    _safe_table_name,
    _sanitize_postgresql_dsn,
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
