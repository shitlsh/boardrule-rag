"""Page marker scanning (HTML comments, [p.xx]) and NEED_MORE_CONTEXT detection."""

from __future__ import annotations

import re
from typing import Any

# Model may emit "NEED_MORE_CONTEXT:" or full-width colon (Unicode)
NEED_MORE_CONTEXT_PATTERN = re.compile(
    r"NEED_MORE_CONTEXT\s*[:：]\s*",
    re.IGNORECASE | re.MULTILINE,
)

# [p.12], [p. 12], [p.12-15], [p.12–15] (ASCII or en dash)
_BRACKET_PAGE_RE = re.compile(
    r"\[p\.\s*(\d+)(?:\s*[–-]\s*(\d+))?\]",
    re.IGNORECASE,
)

# Reuse same token grammar as ingestion/node_builders for <!-- pages: ... -->
_PAGE_COMMENT_RE = re.compile(
    r"<!--\s*pages:\s*([^>]+?)\s*-->",
    re.IGNORECASE,
)


def text_contains_need_more_context(text: str) -> bool:
    return bool(text and NEED_MORE_CONTEXT_PATTERN.search(text))


def _parse_comment_token(raw: str) -> tuple[int | None, int | None]:
    s = raw.strip()
    if s == "?" or not s:
        return None, None
    m = re.match(r"^(\d+)\s*[–-]\s*(\d+)$", s)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return min(a, b), max(a, b)
    m = re.match(r"^(\d+)$", s)
    if m:
        p = int(m.group(1))
        return p, p
    return None, None


def _spans_from_merged_markdown(md: str) -> list[tuple[int, int | None, int | None]]:
    """Ordered (position, page_start, page_end); unknown pages omitted from continuity check."""
    spans: list[tuple[int, int | None, int | None]] = []
    for m in _PAGE_COMMENT_RE.finditer(md):
        lo, hi = _parse_comment_token(m.group(1))
        spans.append((m.start(), lo, hi))
    for m in _BRACKET_PAGE_RE.finditer(md):
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        lo, hi = min(a, b), max(a, b)
        spans.append((m.start(), lo, hi))
    spans.sort(key=lambda x: x[0])
    return spans


def page_continuity_warnings(md: str, *, prefix: str = "merge_and_refine") -> list[str]:
    """
    If page markers along document order are not non-decreasing (next start < prior max), emit warnings.

    Unknown (`?`) anchors are skipped for comparison; bracket and HTML anchors are merged by position.
    """
    if not (md or "").strip():
        return []
    spans = _spans_from_merged_markdown(md)
    warnings: list[str] = []
    last_hi: int | None = None
    for _pos, lo, hi in spans:
        if lo is None or hi is None:
            continue
        if last_hi is not None and lo < last_hi:
            warnings.append(
                f"{prefix}: page markers not non-decreasing "
                f"(section starting at page {lo} follows content up to page {last_hi})"
            )
        last_hi = hi if last_hi is None else max(last_hi, hi)
    return warnings


def supplement_chapter_page_metadata(chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Fill page_start/page_end/pages from the first [p.xx] in body text when metadata lacks anchors.
    Aligns with ingestion/node_builders schema.
    """
    out: list[dict[str, Any]] = []
    for ch in chapters:
        meta = dict(ch.get("metadata") or {})
        text = ch.get("text") or ""
        if meta.get("page_start") is None and meta.get("page_end") is None:
            m = _BRACKET_PAGE_RE.search(text)
            if m:
                a = int(m.group(1))
                b = int(m.group(2)) if m.group(2) else a
                lo, hi = min(a, b), max(a, b)
                meta["page_start"] = lo
                meta["page_end"] = hi
                pr = f"{lo}-{hi}" if lo != hi else str(lo)
                meta["pages"] = pr
                meta["original_page_range"] = pr
        out.append({"text": ch.get("text", ""), "metadata": meta})
    return out
