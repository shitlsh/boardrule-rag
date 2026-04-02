"""LangGraph extraction state."""

from __future__ import annotations

from typing import Any, TypedDict


class ExtractionState(TypedDict, total=False):
    """State carried through the six-node extraction graph."""

    game_id: str
    # Human-readable name for prompts (defaults to game_id if omitted)
    game_name: str
    # Optional glossary / 术语快查 text (e.g. from knowledge retrieval or admin paste)
    terminology_context: str
    source_file: str
    source_url: str | None
    # Full markdown from LlamaParse (with page markers when available)
    parsed_text: str
    parsed_metadata: dict[str, Any]
    # TOC analyzer (Flash) — structured outline
    toc: dict[str, Any]
    # "simple" | "complex" — from route node
    complexity: str
    # Text segments to run chapter extraction on
    batches: list[str]
    # One structured markdown chunk per batch (with page anchors)
    chapter_outputs: list[str]
    merged_markdown: str
    quick_start: str
    suggested_questions: list[str]
    errors: list[str]
    retry_count: int
    # Last checkpoint id for clients that poll / resume (LangGraph thread id is separate)
    last_checkpoint_id: str | None
