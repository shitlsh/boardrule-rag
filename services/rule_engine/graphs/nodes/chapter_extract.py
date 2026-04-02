"""Node 4: Chapter-level structured extraction (Gemini Pro), per batch."""

from __future__ import annotations

from graphs.state import ExtractionState
from utils.gemini import generate_pro
from utils.paths import load_prompt
from utils.prompt_context import fill_prompt_placeholders
from utils.retry import retry


def run(state: ExtractionState) -> dict:
    rule_style_core = fill_prompt_placeholders(load_prompt("rule_style_core.md"), state)
    template = load_prompt("chapter_extract_strict.md")
    batches = state.get("batches") or []
    if not batches:
        return {
            "chapter_outputs": [],
            "errors": (state.get("errors") or []) + ["chapter_extract: no batches"],
        }

    outputs: list[str] = []
    errs: list[str] = list(state.get("errors") or [])
    for i, batch in enumerate(batches):
        filled = (
            fill_prompt_placeholders(template, state)
            .replace("{{RULE_STYLE_CORE}}", rule_style_core)
            .replace("{{BATCH_TEXT}}", batch[:180_000])
        )
        prompt = f"{filled}\n\n（本批为第 {i + 1}/{len(batches)} 批）"
        try:

            def _call() -> str:
                return generate_pro(prompt, temperature=0.0, max_output_tokens=8192)

            out = retry(_call, attempts=3)
            outputs.append(out)
        except Exception as e:  # noqa: BLE001
            errs.append(f"chapter_extract batch {i + 1}: {e}")
            outputs.append(f"<!-- extract failed batch {i + 1}: {e} -->")

    return {"chapter_outputs": outputs, "errors": errs}
