"""Node 1: TOC / structure analysis (Gemini Flash) — vision on TOC pages only."""

from __future__ import annotations

from graphs.state import ExtractionState
from utils.gemini import FLASH_TOC, GeminiCallMeta, build_labeled_image_parts, generate_flash_vision
from utils.json_extract import parse_json_object
from utils.prompt_context import render_prompt
from utils.retry import retry


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

    if labeled:
        base = render_prompt("toc_analyzer_vision.md", state)
        parts = build_labeled_image_parts(
            labeled,
            preamble=base + "\n\n你将看到以下目录页图片（已标注物理页码）：\n",
            closing="\n\n请严格按照 toc_analyzer_vision 要求只输出 JSON。",
        )
        try:

            def _call() -> str:
                return generate_flash_vision(
                    parts,
                    preset=FLASH_TOC,
                    meta=GeminiCallMeta(node="toc_analyzer", prompt_file="toc_analyzer_vision.md"),
                )

            raw = retry(_call, attempts=3)
            toc = parse_json_object(raw)
        except Exception as e:  # noqa: BLE001
            err = f"toc_analyzer vision: {e}"
            return {"errors": (state.get("errors") or []) + [err], "toc": {}}
        return {"toc": toc}

    # Fallback: legacy text (should be rare)
    text = state.get("parsed_text") or ""
    if not text.strip():
        return {"errors": (state.get("errors") or []) + ["toc_analyzer: no TOC pages and empty parsed_text"], "toc": {}}

    base = render_prompt("toc_analyzer.md", state)
    prompt = f"{base}\n\n---\n\n规则书全文：\n\n{text[:200000]}"
    try:
        from utils.gemini import generate_flash

        def _call() -> str:
            return generate_flash(
                prompt,
                preset=FLASH_TOC,
                meta=GeminiCallMeta(node="toc_analyzer", prompt_file="toc_analyzer.md"),
            )

        raw = retry(_call, attempts=3)
        toc = parse_json_object(raw)
    except Exception as e:  # noqa: BLE001
        err = f"toc_analyzer: {e}"
        return {"errors": (state.get("errors") or []) + [err], "toc": {}}
    return {"toc": toc}
