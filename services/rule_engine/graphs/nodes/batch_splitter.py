"""Node 3: Split body pages into vision batches (by page count, not characters)."""

from __future__ import annotations

import os

from graphs.state import ExtractionState

# Max physical pages per Gemini vision call (payload / quota)
_DEFAULT_BATCH_PAGES = 6
_MAX_BATCHES = 64


def _pages_per_batch() -> int:
    raw = os.environ.get("VISION_BATCH_PAGES", str(_DEFAULT_BATCH_PAGES)).strip()
    return int(raw) if raw.isdigit() else _DEFAULT_BATCH_PAGES


def _split_body_into_vision_batches(
    body_indices: list[int],
    by_page: dict[int, str],
    per_batch: int,
) -> list[list[dict[str, object]]]:
    batches: list[list[dict[str, object]]] = []
    chunk: list[dict[str, object]] = []
    for p in sorted(body_indices):
        path = by_page.get(p)
        if not path:
            continue
        chunk.append({"page": p, "path": path})
        if len(chunk) >= per_batch:
            batches.append(chunk)
            chunk = []
    if chunk:
        batches.append(chunk)
    return batches[:_MAX_BATCHES]


def run(state: ExtractionState) -> dict:
    needs_batching = bool(state.get("needs_batching"))
    body = sorted(set(state.get("body_page_indices") or []))
    rows = state.get("page_rows") or []
    by_page: dict[int, str] = {}
    for r in rows:
        p = r.get("page")
        path = r.get("path")
        if p is not None and path:
            by_page[int(p)] = str(path)

    if body and by_page:
        per = _pages_per_batch()
        vb = _split_body_into_vision_batches(body, by_page, per)
        if not needs_batching and len(vb) == 1:
            pass
        elif not needs_batching and len(body) <= per:
            vb = _split_body_into_vision_batches(body, by_page, max(per, len(body)))
        return {"vision_batches": vb}

    return {"vision_batches": []}
