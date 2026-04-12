"""toc_analyzer: skip Flash when no TOC pages selected."""

from __future__ import annotations

from graphs.nodes import toc_analyzer


def test_skip_flash_when_no_toc_indices() -> None:
    state = {
        "toc_page_indices": [],
        "page_rows": [{"page": 1, "path": "/tmp/p1.png"}],
        "errors": [],
    }
    out = toc_analyzer.run(state)
    assert out["errors"] == []
    toc = out["toc"]
    assert toc.get("sections") == []
    assert toc.get("needs_batching") is False
    assert toc.get("estimated_pages") == 0


def test_calls_flash_when_toc_indices_and_paths() -> None:
    """When indices exist but we do not mock LLM, vision path would run — here missing path triggers error branch."""
    state = {
        "toc_page_indices": [1],
        "page_rows": [{"page": 1, "path": ""}],
        "errors": [],
    }
    out = toc_analyzer.run(state)
    assert any("missing rasterized images" in e for e in out["errors"])
    assert out["toc"] == {}
