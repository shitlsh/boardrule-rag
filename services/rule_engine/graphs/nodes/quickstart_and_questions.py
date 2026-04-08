"""Node 6: Quick start text + suggested questions JSON."""

from __future__ import annotations

from graphs.state import ExtractionState
from utils.gemini import FLASH_QUICKSTART, GeminiCallMeta, flash_max_output_tokens, generate_flash
from utils.json_extract import parse_json_object
from utils.prompt_context import render_prompt
from utils.retry import retry


def run(state: ExtractionState) -> dict:
    merged = state.get("merged_markdown") or ""
    if not merged.strip():
        return {
            "quick_start": "",
            "suggested_questions": [],
            "errors": (state.get("errors") or []) + ["quickstart_and_questions: empty merged_markdown"],
        }
    prompt = render_prompt("quickstart_and_questions.md", state, merged=merged[:120_000])
    _mot = flash_max_output_tokens()
    try:

        def _call() -> str:
            return generate_flash(
                prompt,
                preset=FLASH_QUICKSTART,
                max_output_tokens=_mot,
                meta=GeminiCallMeta(node="quickstart_and_questions", prompt_file="quickstart_and_questions.md"),
            )

        raw = retry(_call, attempts=3)
        data = parse_json_object(raw)
        qs = data.get("suggested_questions") or []
        if not isinstance(qs, list):
            qs = []
        qs = [str(x) for x in qs]
        quick = str(data.get("quick_start") or "")
    except Exception as e:  # noqa: BLE001
        return {
            "quick_start": "",
            "suggested_questions": [],
            "errors": (state.get("errors") or []) + [f"quickstart_and_questions: {e}"],
        }
    return {"quick_start": quick, "suggested_questions": qs}
