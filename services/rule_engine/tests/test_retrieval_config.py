"""Manifest-backed retrieval settings."""

from ingestion.index_builder import retrieval_config_from_manifest


def test_retrieval_config_defaults_missing_keys() -> None:
    cfg = retrieval_config_from_manifest({})
    assert cfg.similarity_top_k == 8
    assert cfg.rerank_top_n == 5
    assert cfg.retrieval_mode == "hybrid"
    assert cfg.use_rerank is True


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
