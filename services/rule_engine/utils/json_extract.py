"""Extract JSON from LLM output (handles markdown fences, noise, minor syntax issues)."""

from __future__ import annotations

import json
import re
from typing import Any


def _strip_markdown_fences(text: str) -> str:
    t = text.strip()
    if not t.startswith("```"):
        return t
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", t, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    t = re.sub(r"^```(?:json)?\s*", "", t, count=1, flags=re.IGNORECASE)
    t = re.sub(r"\s*```\s*$", "", t)
    return t.strip()


def _try_load_json(snippet: str) -> dict[str, Any] | None:
    try:
        val = json.loads(snippet)
    except json.JSONDecodeError:
        return None
    return val if isinstance(val, dict) else None


def _relax_trailing_commas(snippet: str) -> str:
    return re.sub(r",\s*([}\]])", r"\1", snippet)


def parse_json_object(text: str, *, strict: bool = False) -> dict[str, Any]:
    """
    Parse a single JSON object from model output.

    Strips optional ``json`` code fences, extracts the outermost ``{...}`` if needed,
    and may fix trailing commas unless *strict* is True.
    """
    raw = (text or "").strip()
    if not raw:
        raise ValueError("parse_json_object: empty input")

    cleaned = _strip_markdown_fences(raw)

    if strict:
        val = json.loads(cleaned)
        if not isinstance(val, dict):
            raise ValueError("parse_json_object: JSON root must be an object")
        return val

    got = _try_load_json(cleaned)
    if got is not None:
        return got

    relaxed = _relax_trailing_commas(cleaned)
    if relaxed != cleaned:
        got = _try_load_json(relaxed)
        if got is not None:
            return got

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        snippet = cleaned[start : end + 1]
        got = _try_load_json(snippet)
        if got is not None:
            return got
        got = _try_load_json(_relax_trailing_commas(snippet))
        if got is not None:
            return got

    raise ValueError(
        "parse_json_object: could not parse a JSON object from model output "
        f"(first 200 chars: {raw[:200]!r})"
    )
