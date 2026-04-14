"""Routing and batching policy (simple vs complex profile)."""

from __future__ import annotations

import os

import pytest

from graphs.nodes import batch_splitter, route_by_complexity
from utils.ai_gateway import boardrule_ai_runtime, parse_boardrule_ai_header


def _minimal_state(
    *,
    body_pages: list[int],
    force_full: bool = False,
    toc: dict | None = None,
) -> dict:
    rows = [{"page": p, "path": f"/tmp/p{p}.png"} for p in body_pages]
    return {
        "body_page_indices": body_pages,
        "page_rows": rows,
        "toc": toc or {"needs_batching": False, "sections": []},
        "force_full_pipeline": force_full,
    }


def test_simple_profile_under_threshold_no_force() -> None:
    st = _minimal_state(body_pages=list(range(1, 11)))  # 10 pages
    out = route_by_complexity.run(st)
    assert out["needs_batching"] is False
    assert out["extraction_profile"] == "simple"
    bs = batch_splitter.run({**st, **out})
    assert len(bs["vision_batches"]) == 1
    assert len(bs["vision_batches"][0]) == 10


def test_simple_path_single_batch_when_body_exceeds_vision_batch_pages() -> None:
    """Previously: needs_batching false but len(body) > VISION_BATCH_PAGES left 6+4 batches."""
    st = _minimal_state(body_pages=list(range(1, 11)))
    out = route_by_complexity.run(st)
    os.environ["VISION_BATCH_PAGES"] = "6"
    try:
        bs = batch_splitter.run({**st, **out})
    finally:
        os.environ.pop("VISION_BATCH_PAGES", None)
    assert len(bs["vision_batches"]) == 1


def test_force_full_skips_simple_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXTRACTION_SIMPLE_MAX_BODY_PAGES", "20")
    st = _minimal_state(body_pages=[1, 2, 3], force_full=True)
    out = route_by_complexity.run(st)
    assert out["extraction_profile"] == "complex"
    # With tiny body and clean toc, needs_batching may still be false — force_full is OR'd in
    assert out["needs_batching"] is True


def test_above_simple_max_sets_needs_batching_for_vision_batches(monkeypatch: pytest.MonkeyPatch) -> None:
    """Past simple_max, batch_splitter must split by VISION_BATCH_PAGES (not merge into one call)."""
    monkeypatch.setenv("EXTRACTION_SIMPLE_MAX_BODY_PAGES", "5")
    st = _minimal_state(body_pages=list(range(1, 11)))
    out = route_by_complexity.run(st)
    assert out["extraction_profile"] == "complex"
    assert out["needs_batching"] is True
    monkeypatch.setenv("VISION_BATCH_PAGES", "5")
    bs = batch_splitter.run({**st, **out})
    assert len(bs["vision_batches"]) == 2
    assert [len(b) for b in bs["vision_batches"]] == [5, 5]


def test_v3_header_extraction_simple_max_body_pages_overrides_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same as BFF: extractionRuntime.extractionSimpleMaxBodyPages in X-Boardrule-Ai-Config snapshot."""
    monkeypatch.setenv("EXTRACTION_SIMPLE_MAX_BODY_PAGES", "100")
    raw = """
    {
      "version": 3,
      "slots": {
        "flash": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.0-flash"},
        "pro": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.5-pro"},
        "embed": {"provider": "gemini", "apiKey": "k", "model": "models/text-embedding-004"},
        "chat": {"provider": "gemini", "apiKey": "k", "model": "m", "temperature": 0.2, "maxTokens": 8192}
      },
      "extractionRuntime": {"extractionSimpleMaxBodyPages": 5}
    }
    """
    cfg = parse_boardrule_ai_header(raw)
    st = _minimal_state(body_pages=list(range(1, 9)))
    with boardrule_ai_runtime(cfg):
        out = route_by_complexity.run(st)
    assert out["extraction_profile"] == "complex"
    assert out["needs_batching"] is True
    monkeypatch.setenv("VISION_BATCH_PAGES", "5")
    with boardrule_ai_runtime(cfg):
        out2 = route_by_complexity.run(st)
    bs = batch_splitter.run({**st, **out2})
    assert len(bs["vision_batches"]) == 2
    assert [len(x) for x in bs["vision_batches"]] == [5, 3]


def test_v3_runtime_simple_max_equality_still_simple_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Gate is body_pages <= simple_max (not strict <)."""
    monkeypatch.delenv("EXTRACTION_SIMPLE_MAX_BODY_PAGES", raising=False)
    raw = """
    {
      "version": 3,
      "slots": {
        "flash": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.0-flash"},
        "pro": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.5-pro"},
        "embed": {"provider": "gemini", "apiKey": "k", "model": "models/text-embedding-004"},
        "chat": {"provider": "gemini", "apiKey": "k", "model": "m", "temperature": 0.2, "maxTokens": 8192}
      },
      "extractionRuntime": {"extractionSimpleMaxBodyPages": 5}
    }
    """
    cfg = parse_boardrule_ai_header(raw)
    st = _minimal_state(body_pages=list(range(1, 6)))
    with boardrule_ai_runtime(cfg):
        out = route_by_complexity.run(st)
    assert out["extraction_profile"] == "simple"
