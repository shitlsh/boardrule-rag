"""Node 6: Quick start text + suggested questions JSON."""

from __future__ import annotations

from graphs.state import ExtractionState
from utils.gemini import generate_flash
from utils.json_extract import parse_json_object
from utils.paths import load_prompt
from utils.prompt_context import fill_prompt_placeholders
from utils.retry import retry


def run(state: ExtractionState) -> dict:
    merged = state.get("merged_markdown") or ""
    if not merged.strip():
        return {
            "quick_start": "",
            "suggested_questions": [],
            "errors": (state.get("errors") or []) + ["quickstart_and_questions: empty merged_markdown"],
        }
    template = fill_prompt_placeholders(load_prompt("quickstart_and_questions.md"), state)
    prompt = template.replace("{{MERGED}}", merged[:120_000])
    try:

        def _call() -> str:
            return generate_flash(prompt, temperature=0.3, max_output_tokens=8192)

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
