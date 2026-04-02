"""Node 3: Split parsed markdown into batches for chapter extraction."""

from __future__ import annotations

from graphs.state import ExtractionState

# Target chunk size (chars) — dynamic batching for long books
_BATCH_TARGET = 14_000
_MAX_BATCHES = 16


def _split_by_chars(text: str) -> list[str]:
    if len(text) <= _BATCH_TARGET:
        return [text]
    batches: list[str] = []
    start = 0
    while start < len(text) and len(batches) < _MAX_BATCHES:
        end = min(start + _BATCH_TARGET, len(text))
        if end < len(text):
            # Prefer breaking at newline
            nl = text.rfind("\n\n", start, end)
            if nl > start + _BATCH_TARGET // 2:
                end = nl
        chunk = text[start:end].strip()
        if chunk:
            batches.append(chunk)
        start = end
    if start < len(text):
        rest = text[start:].strip()
        if rest:
            if batches:
                batches[-1] = batches[-1] + "\n\n" + rest
            else:
                batches.append(rest)
    return batches or [text]


def run(state: ExtractionState) -> dict:
    text = state.get("parsed_text") or ""
    toc = state.get("toc") or {}
    complexity = state.get("complexity") or "simple"
    needs_batching = bool(toc.get("needs_batching")) or complexity == "complex"

    if not needs_batching and len(text) < _BATCH_TARGET:
        batches = [text]
    else:
        batches = _split_by_chars(text)

    return {"batches": batches}
