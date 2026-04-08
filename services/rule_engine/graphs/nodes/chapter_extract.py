"""Node 4: Chapter-level structured extraction (Gemini Pro) — vision batches or legacy text."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from graphs.state import ExtractionState
from utils.gemini import (
    PRO_EXTRACT,
    GeminiCallMeta,
    build_labeled_image_parts,
    generate_pro,
    generate_pro_vision,
    pro_max_output_tokens,
)
from utils.page_markers import text_contains_need_more_context
from utils.prompt_context import render_prompt
from utils.retry import retry


def _vision_batch_pages() -> int:
    raw = os.environ.get("VISION_BATCH_PAGES", "6").strip()
    return int(raw) if raw.isdigit() else 6


def _max_merged_vision_pages() -> int:
    raw = os.environ.get("GEMINI_VISION_MAX_MERGE_PAGES", "").strip()
    if raw.isdigit():
        return int(raw)
    # Default: allow merging several adjacent batches (typical API image limits)
    return min(48, max(12, _vision_batch_pages() * 4))


def _max_expand_steps() -> int:
    raw = os.environ.get("NEED_MORE_CONTEXT_MAX_EXPAND", "8").strip()
    return int(raw) if raw.isdigit() else 8


def run(state: ExtractionState) -> dict:
    rule_style_core = render_prompt("rule_style_core.md", state)
    vision_batches = state.get("vision_batches") or []
    page_rows = state.get("page_rows") or []
    errs: list[str] = list(state.get("errors") or [])
    _mot = pro_max_output_tokens()
    merge_retries = 0

    if vision_batches:
        filled = render_prompt("chapter_extract_vision.md", state, rule_style_core=rule_style_core)
        outputs: list[str] = []
        batch_list: list[list[dict[str, Any]]] = [list(b) for b in vision_batches]
        max_merge = _max_merged_vision_pages()
        expand_cap = _max_expand_steps()
        i = 0
        while i < len(batch_list):
            combined: list[dict[str, Any]] = list(batch_list[i])
            k = i
            page_nums = [int(x["page"]) for x in combined]
            preamble = (
                filled
                + f"\n\n（本批为第 {i + 1}/{len(batch_list)} 批；物理页：{page_nums}）\n"
            )
            labeled = [(int(x["page"]), Path(str(x["path"]))) for x in combined]
            parts = build_labeled_image_parts(
                labeled,
                preamble=preamble,
                closing="\n\n请严格按照 chapter_extract_vision 要求只输出 Markdown 正文。",
            )

            def _call() -> str:
                return generate_pro_vision(
                    parts,
                    preset=PRO_EXTRACT,
                    max_output_tokens=_mot,
                    meta=GeminiCallMeta(
                        node="chapter_extract",
                        prompt_file="chapter_extract_vision.md",
                        call_tag=f"batch_{i + 1}_of_{len(batch_list)}",
                    ),
                )

            try:
                out = retry(_call, attempts=3)
            except Exception as e:  # noqa: BLE001
                errs.append(f"chapter_extract vision batch {i + 1}: {e}")
                outputs.append(f"<!-- extract failed batch {i + 1}: {e} -->")
                i = k + 1
                continue

            steps = 0
            while (
                text_contains_need_more_context(out)
                and k + 1 < len(batch_list)
                and len(combined) + len(batch_list[k + 1]) <= max_merge
                and steps < expand_cap
            ):
                nxt = batch_list[k + 1]
                combined.extend(nxt)
                k += 1
                steps += 1
                merge_retries += 1
                page_nums = [int(x["page"]) for x in combined]
                preamble = (
                    filled
                    + f"\n\n（本批合并自原批次 {i + 1} 起，共 {k - i + 1} 批；物理页：{page_nums}）\n"
                )
                labeled = [(int(x["page"]), Path(str(x["path"]))) for x in combined]
                parts = build_labeled_image_parts(
                    labeled,
                    preamble=preamble,
                    closing="\n\n请严格按照 chapter_extract_vision 要求只输出 Markdown 正文。",
                )

                def _call_merged() -> str:
                    return generate_pro_vision(
                        parts,
                        preset=PRO_EXTRACT,
                        max_output_tokens=_mot,
                        meta=GeminiCallMeta(
                            node="chapter_extract",
                            prompt_file="chapter_extract_vision.md",
                            call_tag=f"merged_from_batch_{i + 1}_step_{steps}",
                        ),
                    )

                try:
                    out = retry(_call_merged, attempts=3)
                except Exception as e:  # noqa: BLE001
                    errs.append(f"chapter_extract merged vision (from batch {i + 1}): {e}")
                    break

            if text_contains_need_more_context(out):
                errs.append(
                    "chapter_extract: NEED_MORE_CONTEXT still present after adjacent-batch merge retries "
                    f"(starting at original batch {i + 1}, {len(combined)} page image(s))"
                )

            outputs.append(out)
            i = k + 1

        prev_retry = int(state.get("retry_count") or 0)
        return {
            "chapter_outputs": outputs,
            "errors": errs,
            "retry_count": prev_retry + merge_retries,
        }

    # Vision pipeline expected for body pages but batch_splitter produced no vision batches
    body_pages = state.get("body_page_indices") or []
    if page_rows and not vision_batches and body_pages:
        return {
            "chapter_outputs": [],
            "errors": errs
            + [
                "chapter_extract: body pages and page_rows present but vision_batches is empty; "
                "cannot fall back to chapter_extract_strict without rasterized page images. "
                "Check page paths in page_rows, VISION_BATCH_PAGES, and batch_splitter output.",
            ],
        }

    batches = state.get("batches") or []
    if not batches:
        return {
            "chapter_outputs": [],
            "errors": errs + ["chapter_extract: no vision_batches and no text batches"],
        }

    outputs = []
    for i, batch in enumerate(batches):
        filled = render_prompt(
            "chapter_extract_strict.md",
            state,
            rule_style_core=rule_style_core,
            batch_text=batch[:180_000],
        )
        prompt = f"{filled}\n\n（本批为第 {i + 1}/{len(batches)} 批）"
        try:

            def _call() -> str:
                return generate_pro(
                    prompt,
                    preset=PRO_EXTRACT,
                    max_output_tokens=_mot,
                    meta=GeminiCallMeta(
                        node="chapter_extract",
                        prompt_file="chapter_extract_strict.md",
                        call_tag=f"text_batch_{i + 1}_of_{len(batches)}",
                    ),
                )

            out = retry(_call, attempts=3)
            outputs.append(out)
        except Exception as e:  # noqa: BLE001
            errs.append(f"chapter_extract batch {i + 1}: {e}")
            outputs.append(f"<!-- extract failed batch {i + 1}: {e} -->")

    return {"chapter_outputs": outputs, "errors": errs}
