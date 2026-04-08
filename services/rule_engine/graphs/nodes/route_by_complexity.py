"""Node 2: Route by complexity (simple vs complex) and whether extraction needs batching."""

from __future__ import annotations

import os

from graphs.state import ExtractionState


def _complexity_threshold_pages() -> int:
    raw = os.environ.get("COMPLEXITY_THRESHOLD_PAGES", "15").strip()
    return int(raw) if raw.isdigit() else 15


def run(state: ExtractionState) -> dict:
    toc = state.get("toc") or {}
    toc_needs = bool(toc.get("needs_batching"))
    sections = toc.get("sections")
    n_sections = len(sections) if isinstance(sections, list) else 0
    body = state.get("body_page_indices") or []
    body_pages = len(body)
    parsed_len = len(state.get("parsed_text") or "")

    if body_pages > 0:
        effective = body_pages * 3500
    else:
        effective = parsed_len

    threshold = _complexity_threshold_pages()
    # Single source of truth for "heavy / needs splitting" (replaces batch_splitter heuristics).
    needs_batching = (
        toc_needs
        or n_sections > 8
        or effective > 40_000
        or body_pages > threshold
    )
    complexity = "complex" if needs_batching else "simple"
    return {"complexity": complexity, "needs_batching": needs_batching}
