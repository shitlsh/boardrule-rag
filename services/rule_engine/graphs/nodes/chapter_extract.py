"""Node 4: Chapter-level structured extraction (Gemini Pro) — vision batches or legacy text."""

from __future__ import annotations

from pathlib import Path

from graphs.state import ExtractionState
from utils.gemini import (
    PRO_EXTRACT,
    build_labeled_image_parts,
    generate_pro,
    generate_pro_vision,
    pro_max_output_tokens,
)
from utils.prompt_context import render_prompt
from utils.retry import retry


def run(state: ExtractionState) -> dict:
    rule_style_core = render_prompt("rule_style_core.md", state)
    vision_batches = state.get("vision_batches") or []
    errs: list[str] = list(state.get("errors") or [])
    _mot = pro_max_output_tokens()

    if vision_batches:
        filled = render_prompt("chapter_extract_vision.md", state, rule_style_core=rule_style_core)
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
                    return generate_pro_vision(parts, preset=PRO_EXTRACT, max_output_tokens=_mot)

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
                return generate_pro(prompt, preset=PRO_EXTRACT, max_output_tokens=_mot)

            out = retry(_call, attempts=3)
            outputs.append(out)
        except Exception as e:  # noqa: BLE001
            errs.append(f"chapter_extract batch {i + 1}: {e}")
            outputs.append(f"<!-- extract failed batch {i + 1}: {e} -->")

    return {"chapter_outputs": outputs, "errors": errs}
