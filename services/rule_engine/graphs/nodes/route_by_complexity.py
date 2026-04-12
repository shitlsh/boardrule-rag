"""Node 2: Route by complexity (simple vs complex) and whether extraction needs batching."""

from __future__ import annotations

import logging

from graphs.extraction_settings import (
    complex_route_body_pages_threshold,
    extraction_simple_max_body_pages,
)
from graphs.state import ExtractionState

_LOG = logging.getLogger(__name__)


def run(state: ExtractionState) -> dict:
    toc = state.get("toc") or {}
    toc_needs = bool(toc.get("needs_batching"))
    sections = toc.get("sections")
    n_sections = len(sections) if isinstance(sections, list) else 0
    body = state.get("body_page_indices") or []
    body_pages = len(body)
    effective = body_pages * 3500

    force_full = bool(state.get("force_full_pipeline"))
    simple_max = extraction_simple_max_body_pages()

    # Simple profile: thin rulebooks — prefer single vision batch, minimal merge drift.
    if not force_full and body_pages <= simple_max:
        out = {
            "complexity": "simple",
            "needs_batching": False,
            "extraction_profile": "simple",
        }
        _LOG.info(
            "route_by_complexity: profile=simple body_pages=%s toc_needs=%s n_sections=%s "
            "needs_batching=%s force_full=%s",
            body_pages,
            toc_needs,
            n_sections,
            out["needs_batching"],
            force_full,
        )
        return out

    # Complex profile: multi-stage batching acceptable; optional user override to always batch.
    complex_body_threshold = complex_route_body_pages_threshold()
    needs_batching = (
        force_full
        or toc_needs
        or n_sections > 8
        or effective > 40_000
        or body_pages > complex_body_threshold
    )
    complexity = "complex" if needs_batching else "simple"
    out = {
        "complexity": complexity,
        "needs_batching": needs_batching,
        "extraction_profile": "complex",
    }
    _LOG.info(
        "route_by_complexity: profile=complex body_pages=%s toc_needs=%s n_sections=%s "
        "needs_batching=%s complexity=%s force_full=%s",
        body_pages,
        toc_needs,
        n_sections,
        needs_batching,
        complexity,
        force_full,
    )
    return out
