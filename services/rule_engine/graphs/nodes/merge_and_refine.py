"""Node 5: Merge batch outputs and refine headings / page comments."""

from __future__ import annotations

from graphs.state import ExtractionState
from ingestion.node_builders import merged_markdown_to_documents
from utils.llm_generate import PRO_MERGE, LlmCallMeta, generate_pro, pro_max_output_tokens
from utils.page_markers import (
    page_continuity_warnings,
    supplement_chapter_page_metadata,
    text_contains_need_more_context,
)
from utils.prompt_context import render_prompt
from utils.retry import retry


def _structured_from_md(state: ExtractionState, md: str) -> list[dict]:
    game_id = state.get("game_id") or ""
    source_file = state.get("source_file") or ""
    docs = merged_markdown_to_documents(
        md.strip(),
        game_id=game_id,
        source_file=source_file or "unknown",
    )
    chapters = [{"text": d.text, "metadata": dict(d.metadata or {})} for d in docs]
    return supplement_chapter_page_metadata(chapters)


def run(state: ExtractionState) -> dict:
    rule_style_core = render_prompt("rule_style_core.md", state)
    chunks = state.get("chapter_outputs") or []
    base_errs = list(state.get("errors") or [])
    _mot = pro_max_output_tokens()
    llm_warns: list[str] = []

    if not chunks:
        return {
            "merged_markdown": "",
            "structured_chapters": [],
            "errors": base_errs + ["merge_and_refine: no chapter_outputs"],
        }

    if any(text_contains_need_more_context(c) for c in chunks):
        joined = "\n\n---\n\n".join(chunks)
        return {
            "merged_markdown": joined.strip(),
            "structured_chapters": [],
            "errors": base_errs
            + [
                "merge_and_refine: chapter outputs still contain NEED_MORE_CONTEXT; "
                "skipped Pro merge/refine and omitted structured_chapters to avoid indexing incomplete text",
            ],
        }

    joined = "\n\n---\n\n".join(chunks)

    # Two-stage merge when very long to avoid truncation
    body = joined
    if len(joined) > 60_000:
        mid = len(chunks) // 2 or 1
        first_half = "\n\n---\n\n".join(chunks[:mid])
        second_half = "\n\n---\n\n".join(chunks[mid:])
        try:

            def _merge_a() -> str:
                p = render_prompt(
                    "merge_refine.md",
                    state,
                    rule_style_core=rule_style_core,
                    chunks=first_half[:120_000],
                )
                return generate_pro(
                    p,
                    preset=PRO_MERGE,
                    max_output_tokens=_mot,
                    meta=LlmCallMeta(
                        node="merge_and_refine",
                        prompt_file="merge_refine.md",
                        call_tag="split_merge_first_half",
                    ),
                    out_warnings=llm_warns,
                )

            def _merge_b() -> str:
                p = render_prompt(
                    "merge_refine.md",
                    state,
                    rule_style_core=rule_style_core,
                    chunks=second_half[:120_000],
                )
                return generate_pro(
                    p,
                    preset=PRO_MERGE,
                    max_output_tokens=_mot,
                    meta=LlmCallMeta(
                        node="merge_and_refine",
                        prompt_file="merge_refine.md",
                        call_tag="split_merge_second_half",
                    ),
                    out_warnings=llm_warns,
                )

            part_a = retry(_merge_a, attempts=2)
            part_b = retry(_merge_b, attempts=2)
            body = part_a + "\n\n" + part_b
        except Exception as e:  # noqa: BLE001
            md = joined[:200_000]
            cont = page_continuity_warnings(md)
            return {
                "merged_markdown": md,
                "structured_chapters": _structured_from_md(state, md),
                "errors": base_errs + llm_warns + [f"merge_and_refine split: {e}"] + cont,
            }

    prompt = render_prompt(
        "merge_refine.md",
        state,
        rule_style_core=rule_style_core,
        chunks=body[:200_000],
    )
    try:

        def _final() -> str:
            return generate_pro(
                prompt,
                preset=PRO_MERGE,
                max_output_tokens=_mot,
                meta=LlmCallMeta(node="merge_and_refine", prompt_file="merge_refine.md", call_tag="final"),
                out_warnings=llm_warns,
            )

        merged_md = retry(_final, attempts=3)
    except Exception as e:  # noqa: BLE001
        md = body[:200_000]
        cont = page_continuity_warnings(md)
        return {
            "merged_markdown": md,
            "structured_chapters": _structured_from_md(state, md),
            "errors": base_errs + llm_warns + [f"merge_and_refine: {e}"] + cont,
        }
    merged_md = merged_md.strip()
    cont = page_continuity_warnings(merged_md)
    return {
        "merged_markdown": merged_md,
        "structured_chapters": _structured_from_md(state, merged_md),
        "errors": base_errs + llm_warns + cont,
    }
