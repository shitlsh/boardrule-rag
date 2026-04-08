"""Chunking: Markdown headers, page anchors, metadata."""

from ingestion.node_builders import (
    documents_to_nodes,
    format_header_path_for_prompt,
    merged_markdown_to_documents,
)


def test_merged_markdown_preserves_page_metadata() -> None:
    md = """<!-- pages: 2 -->
# 章节 A
正文。
<!-- pages: 5-6 -->
## 小节
更多。
"""
    docs = merged_markdown_to_documents(md, game_id="g1", source_file="rules.md")
    assert len(docs) == 2
    assert docs[0].metadata["pages"] == "2"
    assert docs[1].metadata["pages"] == "5-6"


def test_documents_to_nodes_sets_header_path_and_pages() -> None:
    md = """<!-- pages: 3 -->
# 第一章
内容甲。
## 1.1 细则
列表项。
"""
    docs = merged_markdown_to_documents(md, game_id="g1", source_file="rules.md")
    nodes = documents_to_nodes(docs, chunk_size=256, chunk_overlap=32)
    assert nodes
    by_pages = {n.metadata.get("pages"): n for n in nodes}
    assert "3" in by_pages
    n = by_pages["3"]
    assert n.metadata.get("game_id") == "g1"
    assert "header_path" in n.metadata
    hp = n.metadata.get("header_path")
    assert hp is not None
    formatted = format_header_path_for_prompt(hp)
    assert formatted


def test_format_header_path_for_prompt() -> None:
    assert format_header_path_for_prompt("/第一章/第二节/") == "第一章 › 第二节"
    assert format_header_path_for_prompt("/") == ""
    assert format_header_path_for_prompt(None) == ""
