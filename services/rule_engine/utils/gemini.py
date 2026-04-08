"""Gemini client wrapper (Flash / Pro, text + multimodal vision).

All generation uses named presets for temperature and max_output_tokens (from env).

When LangSmith tracing is enabled (``LANGCHAIN_TRACING_V2`` / ``LANGSMITH_TRACING_V2``
and a LangSmith API key), optional :class:`GeminiCallMeta` attaches node / prompt file /
SHA-256 to a child ``llm`` run via ``langsmith.run_helpers.trace``. If tracing is off or
``meta`` is omitted, behavior matches untraced calls (no extra imports or network).
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import google.generativeai as genai

# Preset names (use at call sites to avoid magic strings)
FLASH_TOC = "flash_toc"
FLASH_QUICKSTART = "flash_quickstart"
PRO_EXTRACT = "pro_extract"
PRO_MERGE = "pro_merge"

FlashPreset = Literal["flash_toc", "flash_quickstart"]
ProPreset = Literal["pro_extract", "pro_merge"]


@dataclass(frozen=True)
class GeminiCallMeta:
    """Per-call metadata for LangSmith (optional; see module docstring)."""

    node: str
    prompt_file: str | None = None
    prompt_sha256: str | None = None
    call_tag: str | None = None


def _configure() -> None:
    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_API_KEY is not set")
    genai.configure(api_key=key)


def flash_model_name() -> str:
    return os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.0-flash")


def pro_model_name() -> str:
    return os.environ.get("GEMINI_PRO_MODEL", "gemini-1.5-pro")


def flash_max_output_tokens() -> int:
    raw = os.environ.get("GEMINI_FLASH_MAX_OUTPUT_TOKENS", "8192").strip()
    return int(raw) if raw.isdigit() else 8192


def pro_max_output_tokens() -> int:
    raw = os.environ.get("GEMINI_PRO_MAX_OUTPUT_TOKENS", "8192").strip()
    return int(raw) if raw.isdigit() else 8192


# (temperature,) — max tokens come from flash_max_output_tokens() / pro_max_output_tokens()
_FLASH_PRESET_TEMP: dict[FlashPreset, float] = {
    "flash_toc": 0.1,
    "flash_quickstart": 0.3,
}

_PRO_PRESET_TEMP: dict[ProPreset, float] = {
    "pro_extract": 0.0,
    "pro_merge": 0.0,
}


def _generation_config(*, temperature: float, max_output_tokens: int) -> genai.GenerationConfig:
    return genai.GenerationConfig(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )


def _tracing_enabled_for_gemini() -> bool:
    """Match LangSmith expectations: TRACING_V2 truthy + API key present."""
    v = (
        os.environ.get("LANGSMITH_TRACING_V2")
        or os.environ.get("LANGCHAIN_TRACING_V2")
        or ""
    ).strip().lower()
    if v not in ("true", "1"):
        return False
    key = (os.environ.get("LANGSMITH_API_KEY") or os.environ.get("LANGCHAIN_API_KEY") or "").strip()
    return bool(key)


def _sha256_for_content(contents: str | list[Any], explicit: str | None) -> str:
    if explicit:
        return explicit
    if isinstance(contents, str):
        return hashlib.sha256(contents.encode("utf-8")).hexdigest()
    h = hashlib.sha256()
    for p in contents:
        if isinstance(p, str):
            h.update(p.encode("utf-8"))
        else:
            h.update(b"<non-text-part>")
    return h.hexdigest()


def _generate_with_optional_trace(
    model: genai.GenerativeModel,
    contents: str | list[Any],
    *,
    meta: GeminiCallMeta | None,
    empty_error: str,
) -> str:
    def _call() -> str:
        response = model.generate_content(contents)
        if not response.text:
            raise RuntimeError(empty_error)
        return response.text

    if meta is None or not _tracing_enabled_for_gemini():
        return _call()

    try:
        from langsmith.run_helpers import trace
    except ImportError:
        return _call()

    sha = _sha256_for_content(contents, meta.prompt_sha256)
    md: dict[str, Any] = {
        "gemini_node": meta.node,
        "prompt_sha256": sha,
    }
    if meta.prompt_file:
        md["prompt_file"] = meta.prompt_file
    if meta.call_tag:
        md["call_tag"] = meta.call_tag

    trace_name = f"gemini:{meta.node}"
    with trace(
        trace_name,
        run_type="llm",
        metadata=md,
        inputs={
            "prompt_file": meta.prompt_file or "",
            "prompt_sha256": sha,
            "call_tag": meta.call_tag or "",
        },
    ) as run:
        try:
            out = _call()
            run.end(outputs={"response_chars": len(out)})
            return out
        except Exception as e:
            run.end(error=repr(e))
            raise


def generate_flash(
    prompt: str,
    *,
    preset: FlashPreset,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    meta: GeminiCallMeta | None = None,
) -> str:
    _configure()
    temp = temperature if temperature is not None else _FLASH_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else flash_max_output_tokens()
    model = genai.GenerativeModel(
        flash_model_name(),
        generation_config=_generation_config(temperature=temp, max_output_tokens=mot),
    )
    return _generate_with_optional_trace(
        model,
        prompt,
        meta=meta,
        empty_error="Gemini Flash returned empty response",
    )


def generate_pro(
    prompt: str,
    *,
    preset: ProPreset,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    meta: GeminiCallMeta | None = None,
) -> str:
    _configure()
    temp = temperature if temperature is not None else _PRO_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else pro_max_output_tokens()
    model = genai.GenerativeModel(
        pro_model_name(),
        generation_config=_generation_config(temperature=temp, max_output_tokens=mot),
    )
    return _generate_with_optional_trace(
        model,
        prompt,
        meta=meta,
        empty_error="Gemini Pro returned empty response",
    )


def _pil_open(path: Path | str):
    from PIL import Image

    p = Path(path) if isinstance(path, str) else path
    return Image.open(p).convert("RGB")


def build_labeled_image_parts(
    labeled_pages: list[tuple[int, Path]],
    *,
    preamble: str = "",
    closing: str = "",
) -> list[Any]:
    """
    Interleave explicit page labels with images to reduce page-number hallucination.

    Each item is (1-based physical page number, image path).
    """
    parts: list[Any] = []
    if preamble:
        parts.append(preamble)
    for page_num, img_path in labeled_pages:
        parts.append(f"以下是第 {page_num} 页（物理页码 {page_num}）：")
        parts.append(_pil_open(img_path))
    if closing:
        parts.append(closing)
    return parts


def generate_flash_vision(
    parts: list[Any],
    *,
    preset: FlashPreset = "flash_toc",
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    meta: GeminiCallMeta | None = None,
) -> str:
    """Multimodal Flash (images + text parts)."""
    _configure()
    temp = temperature if temperature is not None else _FLASH_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else flash_max_output_tokens()
    model = genai.GenerativeModel(
        flash_model_name(),
        generation_config=_generation_config(temperature=temp, max_output_tokens=mot),
    )
    return _generate_with_optional_trace(
        model,
        parts,
        meta=meta,
        empty_error="Gemini Flash returned empty response (vision)",
    )


def generate_pro_vision(
    parts: list[Any],
    *,
    preset: ProPreset = "pro_extract",
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    meta: GeminiCallMeta | None = None,
) -> str:
    """Multimodal Pro (images + text parts)."""
    _configure()
    temp = temperature if temperature is not None else _PRO_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else pro_max_output_tokens()
    model = genai.GenerativeModel(
        pro_model_name(),
        generation_config=_generation_config(temperature=temp, max_output_tokens=mot),
    )
    return _generate_with_optional_trace(
        model,
        parts,
        meta=meta,
        empty_error="Gemini Pro returned empty response (vision)",
    )
