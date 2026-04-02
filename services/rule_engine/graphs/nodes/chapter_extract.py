"""Node 4: Chapter-level structured extraction (Gemini Pro) — vision batches or legacy text."""

from __future__ import annotations

from pathlib import Path

from graphs.state import ExtractionState
from utils.gemini import build_labeled_image_parts, generate_pro, generate_pro_vision
from utils.paths import load_prompt
from utils.prompt_context import fill_prompt_placeholders
from utils.retry import retry


def run(state: ExtractionState) -> dict:
    rule_style_core = fill_prompt_placeholders(load_prompt("rule_style_core.md"), state)
    vision_batches = state.get("vision_batches") or []
    errs: list[str] = list(state.get("errors") or [])

    if vision_batches:
        template = fill_prompt_placeholders(load_prompt("chapter_extract_vision.md"), state)
        filled = template.replace("{{RULE_STYLE_CORE}}", rule_style_core)
        outputs: list[str] = []
        for i, batch in enumerate(vision_batches):
            labeled: list[tuple[int, Path]] = []
            for x in batch:
                labeled.append((int(x["page"]), Path(str(x["path"]))))
            page_nums = [p for p, _ in labeled]
            preamble = (
                filled
                + f"\n\n（本批为第 {i + 1}/{len(vision_batches)} 批；物理页：{page_nums}）\n"
            )
            parts = build_labeled_image_parts(
                labeled,
                preamble=preamble,
                closing="\n\n请严格按照 chapter_extract_vision 要求只输出 Markdown 正文。",
            )
            try:

                def _call() -> str:
                    return generate_pro_vision(parts, temperature=0.0)

                out = retry(_call, attempts=3)
                outputs.append(out)
            except Exception as e:  # noqa: BLE001
                errs.append(f"chapter_extract vision batch {i + 1}: {e}")
                outputs.append(f"<!-- extract failed batch {i + 1}: {e} -->")
        return {"chapter_outputs": outputs, "errors": errs}

    batches = state.get("batches") or []
    if not batches:
        return {
            "chapter_outputs": [],
            "errors": errs + ["chapter_extract: no vision_batches and no text batches"],
        }

    template = load_prompt("chapter_extract_strict.md")
    outputs = []
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
