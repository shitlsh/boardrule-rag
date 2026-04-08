"""DSN helpers for pgvector / SQLAlchemy."""

from ingestion.index_builder import _paired_pgvector_uris, _sanitize_postgresql_dsn


def test_sanitize_strips_literal_none_port() -> None:
    raw = "postgresql://postgres:postgres@127.0.0.1:None/postgres"
    out = _sanitize_postgresql_dsn(raw)
    assert ":None" not in out
    assert "127.0.0.1/postgres" in out


def test_sanitize_leaves_normal_port() -> None:
    u = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    assert _sanitize_postgresql_dsn(u) == u


def test_paired_uris_for_plain_postgresql() -> None:
    dsn = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    sync, async_ = _paired_pgvector_uris(dsn)
    assert sync.startswith("postgresql+psycopg2://")
    assert async_.startswith("postgresql+asyncpg://")
    assert sync.endswith("127.0.0.1:54322/postgres")
    assert async_.endswith("127.0.0.1:54322/postgres")
