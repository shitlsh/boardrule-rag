"""DSN helpers for pgvector / SQLAlchemy."""

from ingestion.index_builder import (
    _embedding_models_equivalent,
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


def test_paired_uris_for_plain_postgresql() -> None:
    dsn = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    sync, async_ = _paired_pgvector_uris(dsn)
    assert sync.startswith("postgresql+psycopg2://")
    assert async_.startswith("postgresql+asyncpg://")
    assert sync.endswith("127.0.0.1:54322/postgres")
    assert async_.endswith("127.0.0.1:54322/postgres")
