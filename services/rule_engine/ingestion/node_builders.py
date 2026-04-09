"""Split merged rule Markdown into LlamaIndex nodes with page/source metadata."""

from __future__ import annotations

import re
from typing import Any

from llama_index.core import Document
from llama_index.core.node_parser import MarkdownNodeParser, SentenceSplitter
from llama_index.core.node_parser.text.sentence import CHUNKING_REGEX
from llama_index.core.schema import MetadataMode, TextNode

# Matches <!-- pages: 12-15 -->, <!-- pages: 12 -->, <!-- pages: ? -->
_PAGE_ANCHOR_RE = re.compile(
    r"<!--\s*pages:\s*([^>]+?)\s*-->",
    re.IGNORECASE,
)
_SPLIT_RE = re.compile(
    r"(<!--\s*pages:\s*[^>]+\s*-->)",
    re.IGNORECASE,
)
# ATX headings with 3+ hashes split too finely in ``MarkdownNodeParser`` (each ### becomes its own
# node). Demote to bold lines so only ``#`` / ``##`` drive structure; section content stays coherent.
_DEEP_ATX_HEADER_RE = re.compile(r"^(#{3,6})\s+(.*)$")


def demote_h3_plus_markdown_headings_to_bold(text: str) -> str:
    """
    Replace ``###`` … ``######`` line headers with ``**title**`` (code-fence aware).

    ``MarkdownNodeParser`` splits on every ``#`` line; this keeps e.g. sub-auction rules under one
    ``##`` section instead of one tiny node per ``###``.
    """
    lines = text.split("\n")
    out: list[str] = []
    code_block = False
    for line in lines:
        if line.lstrip().startswith("```"):
            code_block = not code_block
            out.append(line)
            continue
        if not code_block:
            m = _DEEP_ATX_HEADER_RE.match(line)
            if m:
                title = (m.group(2) or "").strip()
                out.append(f"**{title}**" if title else line)
                continue
        out.append(line)
    return "\n".join(out)


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


def format_header_path_for_prompt(raw: str | None) -> str:
    """
    Turn LlamaIndex ``header_path`` (e.g. ``/A/B/``) into a single readable line for prompts.
    """
    if not raw or not str(raw).strip():
        return ""
    s = str(raw).strip()
    if s in ("/", "//"):
        return ""
    parts = [p for p in s.split("/") if p.strip()]
    return " › ".join(parts)


def documents_to_nodes(
    documents: list[Document],
    *,
    chunk_size: int = 1024,
    chunk_overlap: int = 128,
) -> list[TextNode]:
    """
    For each page-level ``Document``: split on Markdown headings (``header_path``), then split
    oversized sections with ``SentenceSplitter`` using Chinese-friendly sentence boundaries.
    """
    if not documents:
        return []

    coarser_docs = [
        Document(
            text=demote_h3_plus_markdown_headings_to_bold(d.get_content(metadata_mode=MetadataMode.NONE)),
            metadata=dict(d.metadata or {}),
        )
        for d in documents
    ]

    md_parser = MarkdownNodeParser.from_defaults()
    md_nodes = md_parser.get_nodes_from_documents(coarser_docs)
    if not md_nodes:
        return []

    # Same defaults as LlamaIndex SentenceSplitter: ``[^,.;。？！]+[,.;。？！]?|[,.;。？！]``
    secondary = CHUNKING_REGEX
    splitter = SentenceSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        secondary_chunking_regex=secondary,
    )
    out = splitter.get_nodes_from_documents(md_nodes)
    return [n for n in out if isinstance(n, TextNode)]


def documents_to_nodes_loose(documents: list[Document]) -> list[TextNode]:
    """Fallback: single huge chunk per document (used when normal pipeline yields nothing)."""
    loose = SentenceSplitter(chunk_size=10_000_000, chunk_overlap=0)
    nodes = loose.get_nodes_from_documents(documents)
    return [n for n in nodes if isinstance(n, TextNode)]
