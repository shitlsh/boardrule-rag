"""Load PDFs/images via LlamaParse and return markdown text."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from llama_parse import LlamaParse


def _api_key() -> str:
    key = os.environ.get("LLAMA_CLOUD_API_KEY")
    if not key:
        raise RuntimeError("LLAMA_CLOUD_API_KEY is not set")
    return key


async def parse_file_to_markdown(path: str | Path) -> tuple[str, dict[str, Any]]:
    """Parse a local file (PDF, images, etc.) via LlamaParse and return markdown + metadata."""
    path = Path(path)
    parser = LlamaParse(
        api_key=_api_key(),
        result_type="markdown",
        verbose=False,
    )
    documents = await parser.aload_data(str(path))
    if not documents:
        return "", {"pages": 0, "source": str(path)}
    texts: list[str] = []
    meta: dict[str, Any] = {"source": str(path)}
    for doc in documents:
        texts.append(doc.text or "")
        if doc.metadata:
            meta.update({k: v for k, v in doc.metadata.items() if k not in meta})
    return "\n\n".join(t for t in texts if t).strip(), meta


def parse_file_to_markdown_sync(path: str | Path) -> tuple[str, dict[str, Any]]:
    """Synchronous parse for background threads (uses sync loader if available)."""
    path = Path(path)
    parser = LlamaParse(
        api_key=_api_key(),
        result_type="markdown",
        verbose=False,
    )
    documents = parser.load_data(str(path))
    if not documents:
        return "", {"pages": 0, "source": str(path)}
    texts: list[str] = []
    meta: dict[str, Any] = {"source": str(path)}
    for doc in documents:
        texts.append(doc.text or "")
        if doc.metadata:
            meta.update({k: v for k, v in doc.metadata.items() if k not in meta})
    return "\n\n".join(t for t in texts if t).strip(), meta
