"""Single place for extraction routing env (simple vs complex profile)."""

from __future__ import annotations

import os

_DEFAULT_SIMPLE_MAX_BODY_PAGES = 10
_DEFAULT_COMPLEX_ROUTE_BODY_PAGES = 15


def extraction_simple_max_body_pages() -> int:
    """Product gate: body page count ≤ this → simple profile (unless force_full_pipeline)."""
    raw = os.environ.get("EXTRACTION_SIMPLE_MAX_BODY_PAGES", "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return _DEFAULT_SIMPLE_MAX_BODY_PAGES


def complex_route_body_pages_threshold() -> int:
    """Complex profile only: OR into needs_batching when body_pages exceeds this."""
    raw = os.environ.get("EXTRACTION_COMPLEX_ROUTE_BODY_PAGES", "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return _DEFAULT_COMPLEX_ROUTE_BODY_PAGES


def simple_path_warn_body_pages() -> int:
    """Log a warning when simple-path single-batch covers more than this many body pages."""
    raw = os.environ.get("EXTRACTION_SIMPLE_PATH_WARN_BODY_PAGES", "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return 32
