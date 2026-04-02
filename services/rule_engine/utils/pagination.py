"""Page range helpers for merged markdown metadata."""

from __future__ import annotations


def clamp_page_range(start: int | None, end: int | None, total_pages: int | None) -> tuple[int | None, int | None]:
    if start is None and end is None:
        return None, None
    s = max(1, start or 1)
    e = end if end is not None else s
    if total_pages is not None:
        e = min(e, total_pages)
        s = min(s, total_pages)
    if e < s:
        e = s
    return s, e
