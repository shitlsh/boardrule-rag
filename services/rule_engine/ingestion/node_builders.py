"""Split merged rule Markdown into LlamaIndex nodes with page/source metadata."""

from __future__ import annotations

import re
from typing import Any

from llama_index.core import Document
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import TextNode

# Matches <!-- pages: 12-15 -->, <!-- pages: 12 -->, <!-- pages: ? -->
_PAGE_ANCHOR_RE = re.compile(
    r"<!--\s*pages:\s*([^>]+?)\s*-->",
    re.IGNORECASE,
)
_SPLIT_RE = re.compile(
    r"(<!--\s*pages:\s*[^>]+\s*-->)",
    re.IGNORECASE,
)


def _parse_page_token(raw: str) -> tuple[int | None, int | None, str]:
    s = raw.strip()
    if s == "?" or not s:
        return None, None, "?"
    m = re.match(r"^(\d+)\s*[–-]\s*(\d+)$", s)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return (min(a, b), max(a, b), f"{a}-{b}")
    m = re.match(r"^(\d+)$", s)
    if m:
        p = int(m.group(1))
        return p, p, str(p)
    return None, None, s


def _section_metadata(
    game_id: str,
    source_file: str,
    page_start: int | None,
    page_end: int | None,
    original_page_range: str,
) -> dict[str, Any]:
    return {
        "game_id": game_id,
        "source_file": source_file,
        "pages": original_page_range,
        "original_page_range": original_page_range,
        "page_start": page_start,
        "page_end": page_end,
    }


def merged_markdown_to_documents(
    merged_markdown: str,
    *,
    game_id: str,
    source_file: str,
) -> list[Document]:
    """
    Split on `<!-- pages: ... -->` anchors.

    Content **following** each anchor inherits that anchor's page metadata until the next anchor.
    Any preamble before the first anchor uses `original_page_range: unknown`.
    """
    text = merged_markdown.strip()
    if not text:
        return []

    parts: list[tuple[str, dict[str, Any]]] = []
    chunks = re.split(_SPLIT_RE, text)
    current_meta = _section_metadata(game_id, source_file, None, None, "unknown")

    i = 0
    while i < len(chunks):
        piece = chunks[i]
        if not piece.strip():
            i += 1
            continue
        if piece.strip().startswith("<!--") and "pages:" in piece.lower():
            m = _PAGE_ANCHOR_RE.search(piece)
            if m:
                ps, pe, pr = _parse_page_token(m.group(1))
                current_meta = _section_metadata(game_id, source_file, ps, pe, pr)
            i += 1
            if i < len(chunks):
                body = chunks[i].strip()
                if body:
                    parts.append((body, dict(current_meta)))
                i += 1
            continue
        body = piece.strip()
        if body:
            parts.append((body, dict(current_meta)))
        i += 1

    if not parts:
        parts.append((text, _section_metadata(game_id, source_file, None, None, "unknown")))

    return [Document(text=body, metadata=meta) for body, meta in parts]


def documents_to_nodes(
    documents: list[Document],
    *,
    chunk_size: int = 1024,
    chunk_overlap: int = 128,
) -> list[TextNode]:
    """Chunk documents; metadata is copied onto each node."""
    splitter = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    return splitter.get_nodes_from_documents(documents)
