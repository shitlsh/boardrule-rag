"""Manifest-backed retrieval settings."""

from ingestion.index_builder import (
    _resolve_chunk_size_overlap_for_build,
    retrieval_config_from_manifest,
)


def test_retrieval_config_defaults_missing_keys() -> None:
    cfg = retrieval_config_from_manifest({})
    assert cfg.similarity_top_k == 8
    assert cfg.rerank_top_n == 5
    assert cfg.retrieval_mode == "hybrid"
    assert cfg.use_rerank is True


def test_resolve_chunk_overrides_only_when_set(monkeypatch) -> None:
    monkeypatch.setenv("CHUNK_SIZE", "1024")
    monkeypatch.setenv("CHUNK_OVERLAP", "128")
    cs, co = _resolve_chunk_size_overlap_for_build(None, None)
    assert cs == 1024 and co == 128
    cs2, co2 = _resolve_chunk_size_overlap_for_build(1536, None)
    assert cs2 == 1536 and co2 == 128
    cs3, co3 = _resolve_chunk_size_overlap_for_build(None, 200)
    assert cs3 == 1024 and co3 == 200


def test_retrieval_config_vector_only_no_rerank() -> None:
    cfg = retrieval_config_from_manifest(
        {
            "similarity_top_k": 12,
            "rerank_top_n": 3,
            "retrieval_mode": "vector_only",
            "use_rerank": False,
        }
    )
    assert cfg.retrieval_mode == "vector_only"
    assert cfg.use_rerank is False
    assert cfg.similarity_top_k == 12
    assert cfg.rerank_top_n == 3
