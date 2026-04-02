"""Node 2: Route by complexity (simple vs complex) from TOC metadata."""

from __future__ import annotations

from graphs.state import ExtractionState


def run(state: ExtractionState) -> dict:
    toc = state.get("toc") or {}
    needs = bool(toc.get("needs_batching"))
    sections = toc.get("sections")
    n_sections = len(sections) if isinstance(sections, list) else 0
    parsed_len = len(state.get("parsed_text") or "")
    if needs or n_sections > 8 or parsed_len > 40_000:
        complexity = "complex"
    else:
        complexity = "simple"
    return {"complexity": complexity}
