"""LangGraph extraction state."""

from __future__ import annotations

from typing import Any, TypedDict


class ExtractionState(TypedDict, total=False):
    """State carried through the six-node extraction graph."""

    game_id: str
    game_name: str
    terminology_context: str
    source_file: str
    source_url: str | None
    # Legacy text path (empty when using vision pipeline)
    parsed_text: str
    parsed_metadata: dict[str, Any]
    # Vision pipeline: rasterized pages (1-based page numbers, absolute paths as str)
    page_rows: list[dict[str, Any]]
    toc_page_indices: list[int]
    exclude_page_indices: list[int]
    # Pages to extract rules from (excludes TOC + exclude sets)
    body_page_indices: list[int]
    # Each inner list is one Gemini batch: [{ "page": int, "path": str }, ...]
    vision_batches: list[list[dict[str, Any]]]
    # TOC analyzer (Flash) — structured outline
    toc: dict[str, Any]
    complexity: str
    # Text batches (legacy); prefer vision_batches for chapter_extract
    batches: list[str]
    chapter_outputs: list[str]
    merged_markdown: str
    # Optional structured chunks for Phase 2 (list of {text, metadata})
    structured_chapters: list[dict[str, Any]]
    quick_start: str
    suggested_questions: list[str]
    errors: list[str]
    retry_count: int
    last_checkpoint_id: str | None
