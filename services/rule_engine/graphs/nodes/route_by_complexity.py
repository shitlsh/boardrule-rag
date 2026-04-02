"""Node 2: Route by complexity (simple vs complex) from TOC metadata + body size."""

from __future__ import annotations

from graphs.state import ExtractionState


def run(state: ExtractionState) -> dict:
    toc = state.get("toc") or {}
    needs = bool(toc.get("needs_batching"))
    sections = toc.get("sections")
    n_sections = len(sections) if isinstance(sections, list) else 0
    body = state.get("body_page_indices") or []
    body_pages = len(body)
    parsed_len = len(state.get("parsed_text") or "")

    if body_pages > 0:
        effective = body_pages * 3500
    else:
        effective = parsed_len

    if needs or n_sections > 8 or effective > 40_000 or body_pages > 12:
        complexity = "complex"
    else:
        complexity = "simple"
    return {"complexity": complexity}
