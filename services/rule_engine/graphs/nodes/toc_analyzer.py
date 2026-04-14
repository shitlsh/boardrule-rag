"""Node 1: TOC / structure analysis (Gemini Flash) — vision on TOC pages only."""

from __future__ import annotations

import logging

from graphs.state import ExtractionState
from utils.llm_generate import FLASH_TOC, LlmCallMeta, build_labeled_image_parts, generate_flash_vision
from utils.json_extract import parse_json_object
from utils.prompt_context import render_prompt
from utils.retry import EXTRACTION_LLM_RETRY_ATTEMPTS, retry

_LOG = logging.getLogger("boardrule.toc_analyzer")

# When no TOC pages are selected, skip Flash and pass a neutral outline for routing.
_SKIPPED_TOC_OUTLINE: dict[str, object] = {
    "sections": [],
    "needs_batching": False,
    "batching_reason": "",
    "estimated_pages": 0,
}


def run(state: ExtractionState) -> dict:
    toc_idxs = sorted(set(state.get("toc_page_indices") or []))
    rows = state.get("page_rows") or []
    by_page = {int(r["page"]): r.get("path") for r in rows if r.get("page") is not None}

    labeled: list[tuple[int, object]] = []
    for p in toc_idxs:
        path = by_page.get(p)
        if path:
            from pathlib import Path

            labeled.append((p, Path(path)))

    if not toc_idxs:
        _LOG.info(
            "toc_analyzer: skip_flash=true labeled_pages=0 toc_indices=[] sections_len=0 "
            "needs_batching=False (no TOC pages selected)",
        )
        return {"toc": dict(_SKIPPED_TOC_OUTLINE), "errors": state.get("errors") or []}

    if labeled:
        _LOG.info(
            "toc_analyzer: skip_flash=false labeled_pages=%s toc_indices=%s",
            len(labeled),
            toc_idxs,
        )
        base = render_prompt("toc_analyzer_vision.md", state)
        parts = build_labeled_image_parts(
            labeled,
            preamble=base + "\n\n你将看到以下目录页图片（已标注物理页码）：\n",
            closing="\n\n请严格按照 toc_analyzer_vision 要求只输出 JSON。",
        )
        llm_warns: list[str] = []
        try:

            def _call() -> str:
                return generate_flash_vision(
                    parts,
                    preset=FLASH_TOC,
                    meta=LlmCallMeta(node="toc_analyzer", prompt_file="toc_analyzer_vision.md"),
                    out_warnings=llm_warns,
                )

            raw = retry(_call, attempts=EXTRACTION_LLM_RETRY_ATTEMPTS)
            toc = parse_json_object(raw)
        except Exception as e:  # noqa: BLE001
            err = f"toc_analyzer vision: {e}"
            return {"errors": (state.get("errors") or []) + llm_warns + [err], "toc": {}}
        sections = toc.get("sections") if isinstance(toc, dict) else None
        n_sec = len(sections) if isinstance(sections, list) else 0
        nb = toc.get("needs_batching") if isinstance(toc, dict) else None
        _LOG.info(
            "toc_analyzer: flash_done sections_len=%s needs_batching=%s",
            n_sec,
            nb,
        )
        return {"toc": toc, "errors": (state.get("errors") or []) + llm_warns}

    _LOG.warning(
        "toc_analyzer: skip_flash=true labeled_pages=0 toc_indices=%s (missing raster paths)",
        toc_idxs,
    )
    errs = list(state.get("errors") or [])
    errs.append(
        "toc_analyzer: missing rasterized images for TOC pages "
        f"{toc_idxs}; each TOC page must have a path in page_rows (vision-only pipeline)",
    )
    return {"errors": errs, "toc": {}}
