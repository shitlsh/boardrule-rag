"""Single place for extraction routing env (simple vs complex profile)."""

from __future__ import annotations

import logging
import os

_LOG = logging.getLogger(__name__)

_DEFAULT_SIMPLE_MAX_BODY_PAGES = 10
_DEFAULT_COMPLEX_ROUTE_BODY_PAGES = 15


def extraction_simple_max_body_pages() -> int:
    """Product gate: body page count ≤ this → simple profile (unless force_full_pipeline)."""
    raw = os.environ.get("EXTRACTION_SIMPLE_MAX_BODY_PAGES", "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return _DEFAULT_SIMPLE_MAX_BODY_PAGES


def complex_route_body_pages_threshold() -> int:
    """
    Used only on the **complex** profile: OR into needs_batching when body_pages exceeds this.

    Deprecated alias: ``COMPLEXITY_THRESHOLD_PAGES`` (same meaning). Prefer
    ``EXTRACTION_COMPLEX_ROUTE_BODY_PAGES`` for new deployments.
    """
    primary = os.environ.get("EXTRACTION_COMPLEX_ROUTE_BODY_PAGES", "").strip()
    if primary.isdigit():
        return max(1, int(primary))
    legacy = os.environ.get("COMPLEXITY_THRESHOLD_PAGES", "").strip()
    if legacy.isdigit():
        _LOG.debug(
            "COMPLEXITY_THRESHOLD_PAGES is deprecated; use EXTRACTION_COMPLEX_ROUTE_BODY_PAGES "
            "(same meaning: complex-route body-page ceiling for batching heuristics).",
        )
        return max(1, int(legacy))
    return _DEFAULT_COMPLEX_ROUTE_BODY_PAGES


def simple_path_warn_body_pages() -> int:
    """Log a warning when simple-path single-batch covers more than this many body pages."""
    raw = os.environ.get("EXTRACTION_SIMPLE_PATH_WARN_BODY_PAGES", "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return 32
