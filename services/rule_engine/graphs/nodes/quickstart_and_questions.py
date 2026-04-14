"""Node 6: Quick start text + suggested questions JSON."""

from __future__ import annotations

from graphs.state import ExtractionState
from utils.llm_generate import FLASH_QUICKSTART, LlmCallMeta, flash_max_output_tokens_for_call, generate_flash
from utils.json_extract import parse_json_object
from utils.prompt_context import render_prompt
from utils.retry import EXTRACTION_LLM_RETRY_ATTEMPTS, retry


def run(state: ExtractionState) -> dict:
    merged = state.get("merged_markdown") or ""
    if not merged.strip():
        return {
            "quick_start": "",
            "suggested_questions": [],
            "errors": (state.get("errors") or []) + ["quickstart_and_questions: empty merged_markdown"],
        }
    prompt = render_prompt("quickstart_and_questions.md", state, merged=merged[:120_000])
    _mot = flash_max_output_tokens_for_call(LlmCallMeta(node="quickstart_and_questions"), FLASH_QUICKSTART)
    llm_warns: list[str] = []
    try:

        def _call() -> str:
            return generate_flash(
                prompt,
                preset=FLASH_QUICKSTART,
                max_output_tokens=_mot,
                meta=LlmCallMeta(node="quickstart_and_questions", prompt_file="quickstart_and_questions.md"),
                out_warnings=llm_warns,
            )

        raw = retry(_call, attempts=EXTRACTION_LLM_RETRY_ATTEMPTS)
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
            "errors": (state.get("errors") or []) + llm_warns + [f"quickstart_and_questions: {e}"],
        }
    base_errs = list(state.get("errors") or [])
    out_errs = base_errs + llm_warns
    if not quick.strip() and len(qs) == 0:
        out_errs = out_errs + [
            "quickstart_and_questions: model returned JSON with empty quick_start and suggested_questions"
        ]
    return {"quick_start": quick, "suggested_questions": qs, "errors": out_errs}
