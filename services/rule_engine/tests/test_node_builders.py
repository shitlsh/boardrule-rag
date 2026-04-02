"""Tests for markdown splitting and metadata."""

from ingestion.node_builders import merged_markdown_to_documents


def test_page_anchors_assign_following_sections():
    md = """Preamble

<!-- pages: 1-2 -->

Section A

<!-- pages: 3 -->

Section B
"""
    docs = merged_markdown_to_documents(md, game_id="g", source_file="r.pdf")
    metas = [d.metadata["pages"] for d in docs]
    assert metas[0] == "unknown"
    assert metas[1] == "1-2"
    assert metas[2] == "3"


def test_no_anchors_all_unknown():
    docs = merged_markdown_to_documents("only text", game_id="g", source_file="r.pdf")
    assert len(docs) == 1
    assert docs[0].metadata["original_page_range"] == "unknown"
