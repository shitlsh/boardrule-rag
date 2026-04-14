"""Node 4: Chapter-level structured extraction (Gemini Pro) — vision batches only."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from graphs.state import ExtractionState
from utils.ai_gateway import get_extraction_runtime
from utils.llm_generate import (
    PRO_EXTRACT,
    LlmCallMeta,
    build_labeled_image_parts,
    generate_pro_vision,
    pro_max_output_tokens_for_call,
)
from ingestion.node_builders import sanitize_invisible_unicode_for_rules_markdown
from utils.page_markers import text_contains_need_more_context
from utils.prompt_context import render_prompt
from utils.retry import retry

_LOG = logging.getLogger("boardrule.chapter_extract")


def _vision_batch_pages() -> int:
    o = get_extraction_runtime()
    if o is not None and o.vision_batch_pages is not None:
        return max(1, int(o.vision_batch_pages))
    raw = os.environ.get("VISION_BATCH_PAGES", "6").strip()
    return int(raw) if raw.isdigit() else 6


def _max_merged_vision_pages() -> int:
    o = get_extraction_runtime()
    if o is not None and o.vision_max_merge_pages is not None:
        return max(1, int(o.vision_max_merge_pages))
    raw = os.environ.get("VISION_MAX_MERGE_PAGES", "").strip()
    if raw.isdigit():
        return int(raw)
    # Default: allow merging several adjacent batches (typical API image limits)
    return min(48, max(12, _vision_batch_pages() * 4))


def _max_expand_steps() -> int:
    o = get_extraction_runtime()
    if o is not None and o.need_more_context_max_expand is not None:
        return max(0, int(o.need_more_context_max_expand))
    raw = os.environ.get("NEED_MORE_CONTEXT_MAX_EXPAND", "8").strip()
    return int(raw) if raw.isdigit() else 8


def run(state: ExtractionState) -> dict:
    rule_style_core = render_prompt("rule_style_core.md", state)
    vision_batches = state.get("vision_batches") or []
    page_rows = state.get("page_rows") or []
    errs: list[str] = list(state.get("errors") or [])
    _mot = pro_max_output_tokens_for_call(LlmCallMeta(node="chapter_extract"), PRO_EXTRACT)
    merge_retries = 0
    llm_warns: list[str] = []

    if vision_batches:
        filled = render_prompt("chapter_extract_vision.md", state, rule_style_core=rule_style_core)
        outputs: list[str] = []
        batch_list: list[list[dict[str, Any]]] = [list(b) for b in vision_batches]
        max_merge = _max_merged_vision_pages()
        expand_cap = _max_expand_steps()
        _LOG.info(
            "chapter_extract: num_vision_batches=%s batch_sizes=%s body_page_indices=%s "
            "max_merge_pages=%s need_more_expand_cap=%s max_output_tokens=%s",
            len(batch_list),
            [len(b) for b in batch_list],
            state.get("body_page_indices") or [],
            max_merge,
            expand_cap,
            _mot,
        )
        i = 0
        while i < len(batch_list):
            combined: list[dict[str, Any]] = list(batch_list[i])
            k = i
            page_nums = [int(x["page"]) for x in combined]
            preamble = (
                filled
                + f"\n\n（本批为第 {i + 1}/{len(batch_list)} 批；物理页：{page_nums}）\n"
            )
            if len(batch_list) == 1:
                preamble += (
                    "\n【单批全文】本批已覆盖本次抽取的**全部正文页**图片。"
                    "禁止用 NEED_MORE_CONTEXT 声称「本批未包含某正文页」；"
                    "若图中确实看不清某段内容，再写 NEED_MORE_CONTEXT 并说明原因。\n"
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
                    meta=LlmCallMeta(
                        node="chapter_extract",
                        prompt_file="chapter_extract_vision.md",
                        call_tag=f"batch_{i + 1}_of_{len(batch_list)}",
                    ),
                    out_warnings=llm_warns,
                )

            _LOG.info(
                "chapter_extract: pro_vision call batch=%s/%s pages=%s image_count=%s",
                i + 1,
                len(batch_list),
                page_nums,
                len(labeled),
            )
            try:
                out = retry(_call, attempts=3)
            except Exception as e:  # noqa: BLE001
                errs.append(f"chapter_extract vision batch {i + 1}: {e}")
                _LOG.warning(
                    "chapter_extract: vision batch %s/%s failed after retries: %s",
                    i + 1,
                    len(batch_list),
                    e,
                )
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
                        meta=LlmCallMeta(
                            node="chapter_extract",
                            prompt_file="chapter_extract_vision.md",
                            call_tag=f"merged_from_batch_{i + 1}_step_{steps}",
                        ),
                        out_warnings=llm_warns,
                    )

                _LOG.info(
                    "chapter_extract: pro_vision merged_expand batch_start=%s step=%s pages=%s image_count=%s",
                    i + 1,
                    steps,
                    page_nums,
                    len(labeled),
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

            outputs.append(sanitize_invisible_unicode_for_rules_markdown(out.strip()))
            i = k + 1

        prev_retry = int(state.get("retry_count") or 0)
        return {
            "chapter_outputs": outputs,
            "errors": errs + llm_warns,
            "retry_count": prev_retry + merge_retries,
        }

    body_pages = state.get("body_page_indices") or []
    if page_rows and not vision_batches and body_pages:
        return {
            "chapter_outputs": [],
            "errors": errs
            + [
                "chapter_extract: body pages and page_rows present but vision_batches is empty; "
                "check page paths in page_rows, VISION_BATCH_PAGES, and batch_splitter output.",
            ],
        }

    return {
        "chapter_outputs": [],
        "errors": errs
        + [
            "chapter_extract: vision extraction requires non-empty vision_batches from rasterized body pages; "
            "text-only extraction is disabled.",
        ],
    }
