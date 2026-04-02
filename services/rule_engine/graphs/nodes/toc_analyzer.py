"""Node 1: TOC / structure analysis (Gemini Flash)."""

from __future__ import annotations

from graphs.state import ExtractionState
from utils.gemini import generate_flash
from utils.json_extract import parse_json_object
from utils.paths import load_prompt
from utils.prompt_context import fill_prompt_placeholders
from utils.retry import retry


def run(state: ExtractionState) -> dict:
    base = fill_prompt_placeholders(load_prompt("toc_analyzer.md"), state)
    text = state.get("parsed_text") or ""
    if not text.strip():
        return {"errors": (state.get("errors") or []) + ["toc_analyzer: empty parsed_text"], "toc": {}}

    prompt = f"{base}\n\n---\n\n规则书全文：\n\n{text[:200000]}"
    try:

        def _call() -> str:
            return generate_flash(prompt, temperature=0.1, max_output_tokens=8192)

        raw = retry(_call, attempts=3)
        toc = parse_json_object(raw)
    except Exception as e:  # noqa: BLE001
        err = f"toc_analyzer: {e}"
        return {"errors": (state.get("errors") or []) + [err], "toc": {}}
    return {"toc": toc}
