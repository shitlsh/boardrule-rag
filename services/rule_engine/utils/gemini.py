"""LLM client wrapper (Flash / Pro, text + multimodal vision).

Runtime config comes from BFF ``X-Boardrule-Ai-Config`` (see ``utils/ai_gateway.py``).
Gemini uses ``google-genai``; OpenRouter and Qwen (DashScope) use OpenAI-compatible chat completions.

When LangSmith tracing is enabled, optional :class:`GeminiCallMeta` attaches metadata to a child ``llm`` run.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from google import genai
from google.genai import types

from utils import dashscope_client as _dashscope
from utils.dashscope_client import resolve_dashscope_api_base
from utils.ai_gateway import get_slots
from utils.openrouter_client import chat_completion_from_parts, chat_completion_text

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


def flash_max_output_tokens() -> int:
    g = get_slots().flash
    return g.max_output_tokens if g.max_output_tokens is not None else 8192


def pro_max_output_tokens() -> int:
    g = get_slots().pro
    return g.max_output_tokens if g.max_output_tokens is not None else 8192


def _qwen_api_base(slot: object) -> str:
    raw = getattr(slot, "dashscope_compatible_base", None)
    return resolve_dashscope_api_base(raw if isinstance(raw, str) else None)


_FLASH_PRESET_TEMP: dict[FlashPreset, float] = {
    "flash_toc": 0.1,
    "flash_quickstart": 0.3,
}

_PRO_PRESET_TEMP: dict[ProPreset, float] = {
    "pro_extract": 0.0,
    "pro_merge": 0.0,
}


def _tracing_enabled_for_llm() -> bool:
    v = (
        os.environ.get("LANGSMITH_TRACING_V2")
        or os.environ.get("LANGCHAIN_TRACING_V2")
        or ""
    ).strip().lower()
    if v not in ("true", "1"):
        return False
    key = (os.environ.get("LANGSMITH_API_KEY") or os.environ.get("LANGCHAIN_API_KEY") or "").strip()
    return bool(key)


def _gemini_http_timeout_ms() -> int | None:
    raw = (os.environ.get("GEMINI_HTTP_TIMEOUT_MS") or "").strip()
    if raw == "":
        return 120_000
    if raw.lower() in ("none", "0", "unlimited"):
        return None
    try:
        return max(1, int(raw))
    except ValueError:
        return 120_000


def _genai_client(api_key: str) -> genai.Client:
    timeout_ms = _gemini_http_timeout_ms()
    if timeout_ms is None:
        return genai.Client(api_key=api_key)
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=timeout_ms))


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


def _generate_once_gemini(
    *,
    api_key: str,
    model: str,
    contents: str | list[Any],
    gen_config: types.GenerateContentConfig,
    empty_error: str,
) -> str:
    client = _genai_client(api_key)
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=gen_config,
    )
    if not response.text:
        raise RuntimeError(empty_error)
    return response.text


def _run_with_optional_trace(
    *,
    provider: str,
    meta: GeminiCallMeta | None,
    contents_for_hash: str | list[Any],
    fn: Callable[[], str],
    empty_error: str,
) -> str:
    def _call() -> str:
        out = fn()
        if not (out or "").strip():
            raise RuntimeError(empty_error)
        return out

    if meta is None or not _tracing_enabled_for_llm():
        return _call()

    try:
        from langsmith.run_helpers import trace
    except ImportError:
        return _call()

    sha = _sha256_for_content(contents_for_hash, meta.prompt_sha256)
    md: dict[str, Any] = {
        "llm_node": meta.node,
        "llm_provider": provider,
        "prompt_sha256": sha,
    }
    if meta.prompt_file:
        md["prompt_file"] = meta.prompt_file
    if meta.call_tag:
        md["call_tag"] = meta.call_tag

    trace_name = f"{provider}:{meta.node}"
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
    slot = get_slots().flash
    temp = temperature if temperature is not None else _FLASH_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else flash_max_output_tokens()
    if slot.provider == "openrouter":

        def _fn() -> str:
            return chat_completion_text(
                api_key=slot.api_key,
                model=slot.model,
                user_text=prompt,
                temperature=temp,
                max_tokens=mot,
            )

        return _run_with_optional_trace(
            provider="openrouter",
            meta=meta,
            contents_for_hash=prompt,
            fn=_fn,
            empty_error="OpenRouter Flash returned empty response",
        )

    if slot.provider == "qwen":

        def _fn_q() -> str:
            return _dashscope.chat_completion_text(
                api_key=slot.api_key,
                api_base=_qwen_api_base(slot),
                model=slot.model,
                user_text=prompt,
                temperature=temp,
                max_tokens=mot,
            )

        return _run_with_optional_trace(
            provider="qwen",
            meta=meta,
            contents_for_hash=prompt,
            fn=_fn_q,
            empty_error="Qwen (DashScope) Flash returned empty response",
        )

    gen_config = types.GenerateContentConfig(temperature=temp, max_output_tokens=mot)

    def _gem() -> str:
        return _generate_once_gemini(
            api_key=slot.api_key,
            model=slot.model,
            contents=prompt,
            gen_config=gen_config,
            empty_error="Gemini Flash returned empty response",
        )

    return _run_with_optional_trace(
        provider="gemini",
        meta=meta,
        contents_for_hash=prompt,
        fn=_gem,
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
    slot = get_slots().pro
    temp = temperature if temperature is not None else _PRO_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else pro_max_output_tokens()
    if slot.provider == "openrouter":

        def _fn() -> str:
            return chat_completion_text(
                api_key=slot.api_key,
                model=slot.model,
                user_text=prompt,
                temperature=temp,
                max_tokens=mot,
            )

        return _run_with_optional_trace(
            provider="openrouter",
            meta=meta,
            contents_for_hash=prompt,
            fn=_fn,
            empty_error="OpenRouter Pro returned empty response",
        )

    if slot.provider == "qwen":

        def _fn_q() -> str:
            return _dashscope.chat_completion_text(
                api_key=slot.api_key,
                api_base=_qwen_api_base(slot),
                model=slot.model,
                user_text=prompt,
                temperature=temp,
                max_tokens=mot,
            )

        return _run_with_optional_trace(
            provider="qwen",
            meta=meta,
            contents_for_hash=prompt,
            fn=_fn_q,
            empty_error="Qwen (DashScope) Pro returned empty response",
        )

    gen_config = types.GenerateContentConfig(temperature=temp, max_output_tokens=mot)

    def _gem() -> str:
        return _generate_once_gemini(
            api_key=slot.api_key,
            model=slot.model,
            contents=prompt,
            gen_config=gen_config,
            empty_error="Gemini Pro returned empty response",
        )

    return _run_with_optional_trace(
        provider="gemini",
        meta=meta,
        contents_for_hash=prompt,
        fn=_gem,
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
    slot = get_slots().flash
    temp = temperature if temperature is not None else _FLASH_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else flash_max_output_tokens()
    if slot.provider == "openrouter":

        def _fn() -> str:
            return chat_completion_from_parts(
                api_key=slot.api_key,
                model=slot.model,
                parts=parts,
                temperature=temp,
                max_tokens=mot,
            )

        return _run_with_optional_trace(
            provider="openrouter",
            meta=meta,
            contents_for_hash=parts,
            fn=_fn,
            empty_error="OpenRouter Flash returned empty response (vision)",
        )

    if slot.provider == "qwen":

        def _fn_q() -> str:
            return _dashscope.chat_completion_from_parts(
                api_key=slot.api_key,
                api_base=_qwen_api_base(slot),
                model=slot.model,
                parts=parts,
                temperature=temp,
                max_tokens=mot,
            )

        return _run_with_optional_trace(
            provider="qwen",
            meta=meta,
            contents_for_hash=parts,
            fn=_fn_q,
            empty_error="Qwen (DashScope) Flash returned empty response (vision)",
        )

    gen_config = types.GenerateContentConfig(temperature=temp, max_output_tokens=mot)

    def _gem() -> str:
        return _generate_once_gemini(
            api_key=slot.api_key,
            model=slot.model,
            contents=parts,
            gen_config=gen_config,
            empty_error="Gemini Flash returned empty response (vision)",
        )

    return _run_with_optional_trace(
        provider="gemini",
        meta=meta,
        contents_for_hash=parts,
        fn=_gem,
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
    slot = get_slots().pro
    temp = temperature if temperature is not None else _PRO_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else pro_max_output_tokens()
    if slot.provider == "openrouter":

        def _fn() -> str:
            return chat_completion_from_parts(
                api_key=slot.api_key,
                model=slot.model,
                parts=parts,
                temperature=temp,
                max_tokens=mot,
            )

        return _run_with_optional_trace(
            provider="openrouter",
            meta=meta,
            contents_for_hash=parts,
            fn=_fn,
            empty_error="OpenRouter Pro returned empty response (vision)",
        )

    if slot.provider == "qwen":

        def _fn_q() -> str:
            return _dashscope.chat_completion_from_parts(
                api_key=slot.api_key,
                api_base=_qwen_api_base(slot),
                model=slot.model,
                parts=parts,
                temperature=temp,
                max_tokens=mot,
            )

        return _run_with_optional_trace(
            provider="qwen",
            meta=meta,
            contents_for_hash=parts,
            fn=_fn_q,
            empty_error="Qwen (DashScope) Pro returned empty response (vision)",
        )

    gen_config = types.GenerateContentConfig(temperature=temp, max_output_tokens=mot)

    def _gem() -> str:
        return _generate_once_gemini(
            api_key=slot.api_key,
            model=slot.model,
            contents=parts,
            gen_config=gen_config,
            empty_error="Gemini Pro returned empty response (vision)",
        )

    return _run_with_optional_trace(
        provider="gemini",
        meta=meta,
        contents_for_hash=parts,
        fn=_gem,
        empty_error="Gemini Pro returned empty response (vision)",
    )
