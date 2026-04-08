"""Routing and batching policy (simple vs complex profile)."""

from __future__ import annotations

import os

import pytest

from graphs.nodes import batch_splitter, route_by_complexity


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


def test_complex_route_uses_legacy_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXTRACTION_SIMPLE_MAX_BODY_PAGES", "5")
    monkeypatch.setenv("COMPLEXITY_THRESHOLD_PAGES", "20")
    monkeypatch.delenv("EXTRACTION_COMPLEX_ROUTE_BODY_PAGES", raising=False)
    # 10 body pages: above simple gate (5), below legacy body threshold (20); keep effective under 40k.
    st = _minimal_state(body_pages=list(range(1, 11)))
    out = route_by_complexity.run(st)
    assert out["extraction_profile"] == "complex"
    assert out["needs_batching"] is False
