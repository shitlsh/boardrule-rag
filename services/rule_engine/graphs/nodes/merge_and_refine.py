"""Node 5: Merge batch outputs and refine headings / page comments."""

from __future__ import annotations

from graphs.state import ExtractionState
from utils.gemini import generate_pro
from utils.paths import load_prompt
from utils.prompt_context import fill_prompt_placeholders
from utils.retry import retry


def run(state: ExtractionState) -> dict:
    rule_style_core = fill_prompt_placeholders(load_prompt("rule_style_core.md"), state)
    template = fill_prompt_placeholders(load_prompt("merge_refine.md"), state)
    chunks = state.get("chapter_outputs") or []
    if not chunks:
        return {
            "merged_markdown": "",
            "errors": (state.get("errors") or []) + ["merge_and_refine: no chapter_outputs"],
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
                p = template.replace("{{RULE_STYLE_CORE}}", rule_style_core).replace("{{CHUNKS}}", first_half[:120_000])
                return generate_pro(p, temperature=0.0, max_output_tokens=8192)

            def _merge_b() -> str:
                p = template.replace("{{RULE_STYLE_CORE}}", rule_style_core).replace("{{CHUNKS}}", second_half[:120_000])
                return generate_pro(p, temperature=0.0, max_output_tokens=8192)

            part_a = retry(_merge_a, attempts=2)
            part_b = retry(_merge_b, attempts=2)
            body = part_a + "\n\n" + part_b
        except Exception as e:  # noqa: BLE001
            return {
                "merged_markdown": joined[:200_000],
                "errors": (state.get("errors") or []) + [f"merge_and_refine split: {e}"],
            }

    prompt = template.replace("{{RULE_STYLE_CORE}}", rule_style_core).replace("{{CHUNKS}}", body[:200_000])
    try:

        def _final() -> str:
            return generate_pro(prompt, temperature=0.0, max_output_tokens=8192)

        merged_md = retry(_final, attempts=3)
    except Exception as e:  # noqa: BLE001
        return {
            "merged_markdown": body[:200_000],
            "errors": (state.get("errors") or []) + [f"merge_and_refine: {e}"],
        }
    return {"merged_markdown": merged_md.strip()}
