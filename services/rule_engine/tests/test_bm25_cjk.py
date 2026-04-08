"""BM25 CJK tokenization smoke tests."""

import tempfile
from pathlib import Path

import bm25s

from ingestion.bm25_retriever import BM25_CJK_TOKEN_PATTERN, BoardruleBM25Retriever, default_bm25_from_nodes
from llama_index.core.schema import TextNode


def test_cjk_token_pattern_non_empty_tokens() -> None:
    text = "移动阶段 draw card 测试"
    tok = bm25s.tokenize(
        text,
        stopwords=[],
        stemmer=None,
        token_pattern=BM25_CJK_TOKEN_PATTERN,
    )
    assert len(tok.vocab) >= 3


def test_bm25_persist_roundtrip_restores_token_pattern() -> None:
    nodes = [
        TextNode(text="中文规则 与 English mix", metadata={"game_id": "x"}),
        TextNode(text="另一段 phase one", metadata={"game_id": "x"}),
    ]
    r = default_bm25_from_nodes(nodes, similarity_top_k=2)
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        r.persist(str(p))
        r2 = BoardruleBM25Retriever.from_persist_dir(str(p))
        assert r2.token_pattern == BM25_CJK_TOKEN_PATTERN
        assert r2.skip_stemming is True
        args = r2.get_persist_args()
        assert args.get("language") == []
        q = r2.retrieve("中文")
        assert q is not None
