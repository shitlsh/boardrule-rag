"""Slot-based LLM generation (Flash / Pro, text + vision).

Routes to **Gemini**, **OpenRouter**, **Qwen (DashScope)**, or **Bedrock** per
``X-Boardrule-Ai-Config`` (see ``utils/ai_gateway.py``).  Supports optional
**continuation** when the model hits output length limits.

When LangSmith tracing is enabled, optional :class:`LlmCallMeta` attaches
metadata to a child ``llm`` run.

Provider dispatch is centralised in :func:`_build_provider` — adding a new
provider only requires a change there.  The continuation loop and rate-limit
retry are handled generically by ``utils.providers``.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from google.genai import types

from utils.ai_gateway import (
    BoardruleAiConfigV3,
    FlashProSlot,
    SlotsBundleV3,
    get_config,
    get_extraction_runtime,
    get_slots,
)
from utils.dashscope_client import resolve_dashscope_api_base
from utils.providers.base import LlmProvider, run_with_continuation
from utils.providers.gemini import GeminiProvider
from utils.providers.openai_compat import OpenAICompatProvider

# Preset names (use at call sites to avoid magic strings)
FLASH_TOC = "flash_toc"
FLASH_QUICKSTART = "flash_quickstart"
PRO_EXTRACT = "pro_extract"
PRO_MERGE = "pro_merge"

FlashPreset = Literal["flash_toc", "flash_quickstart"]
ProPreset = Literal["pro_extract", "pro_merge"]

# Default max output tokens when BFF omits maxOutputTokens.
_DEFAULT_SLOT_MAX_OUTPUT = 32768
_ENV_PRO_DEFAULT = "BOARDRULE_PRO_MAX_OUTPUT_TOKENS_DEFAULT"
_ENV_FLASH_DEFAULT = "BOARDRULE_FLASH_MAX_OUTPUT_TOKENS_DEFAULT"
_ENV_MAX_CONTINUATION = "BOARDRULE_LLM_MAX_CONTINUATION_ROUNDS"


@dataclass(frozen=True)
class LlmCallMeta:
    """Per-call metadata for LangSmith (optional; see module docstring)."""

    node: str
    prompt_file: str | None = None
    prompt_sha256: str | None = None
    call_tag: str | None = None


# Backward-compatible alias (older name referenced "Gemini" only).
GeminiCallMeta = LlmCallMeta


# ---------------------------------------------------------------------------
# Slot resolution helpers
# ---------------------------------------------------------------------------


def _env_positive_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if raw.isdigit():
        v = int(raw)
        return max(1, v)
    return default


def _max_continuation_rounds() -> int:
    o = get_extraction_runtime()
    if o is not None and o.llm_max_continuation_rounds is not None:
        return max(0, int(o.llm_max_continuation_rounds))
    return _env_positive_int(_ENV_MAX_CONTINUATION, 6)


def _slots_v3() -> SlotsBundleV3 | None:
    c = get_config()
    if isinstance(c, BoardruleAiConfigV3):
        return c.slots
    return None


def _resolve_flash_slot(meta: LlmCallMeta | None, preset: FlashPreset) -> FlashProSlot:
    s3 = _slots_v3()
    base = get_slots().flash
    if s3 is None:
        return base
    node = (meta.node if meta else "") or ""
    if node == "toc_analyzer" and s3.flash_toc is not None:
        return s3.flash_toc
    if node == "quickstart_and_questions" and s3.flash_quickstart is not None:
        return s3.flash_quickstart
    if preset == FLASH_TOC and s3.flash_toc is not None:
        return s3.flash_toc
    if preset == FLASH_QUICKSTART and s3.flash_quickstart is not None:
        return s3.flash_quickstart
    return base


def _resolve_pro_slot(meta: LlmCallMeta | None, preset: ProPreset) -> FlashProSlot:
    s3 = _slots_v3()
    base = get_slots().pro
    if s3 is None:
        return base
    node = (meta.node if meta else "") or ""
    if node == "chapter_extract" and s3.pro_extract is not None:
        return s3.pro_extract
    if node == "merge_and_refine" and s3.pro_merge is not None:
        return s3.pro_merge
    if preset == PRO_EXTRACT and s3.pro_extract is not None:
        return s3.pro_extract
    if preset == PRO_MERGE and s3.pro_merge is not None:
        return s3.pro_merge
    return base


def _max_output_for_flash_slot(slot: FlashProSlot) -> int:
    if slot.max_output_tokens is not None:
        return int(slot.max_output_tokens)
    raw = (os.environ.get(_ENV_FLASH_DEFAULT) or "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return _DEFAULT_SLOT_MAX_OUTPUT


def _max_output_for_pro_slot(slot: FlashProSlot) -> int:
    if slot.max_output_tokens is not None:
        return int(slot.max_output_tokens)
    raw = (os.environ.get(_ENV_PRO_DEFAULT) or "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return _DEFAULT_SLOT_MAX_OUTPUT


def flash_max_output_tokens() -> int:
    return _max_output_for_flash_slot(get_slots().flash)


def pro_max_output_tokens() -> int:
    return _max_output_for_pro_slot(get_slots().pro)


def flash_max_output_tokens_for_call(meta: LlmCallMeta | None, preset: FlashPreset) -> int:
    return _max_output_for_flash_slot(_resolve_flash_slot(meta, preset))


def pro_max_output_tokens_for_call(meta: LlmCallMeta | None, preset: ProPreset) -> int:
    return _max_output_for_pro_slot(_resolve_pro_slot(meta, preset))


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


# ---------------------------------------------------------------------------
# Gemini client factory (timeout forwarding)
# ---------------------------------------------------------------------------


def _gemini_http_timeout_ms() -> int | None:
    o = get_extraction_runtime()
    if o is not None and o.gemini_http_timeout_ms is not None:
        v = o.gemini_http_timeout_ms
        if v <= 0:
            return None
        return max(1, int(v))
    raw = (os.environ.get("GEMINI_HTTP_TIMEOUT_MS") or "").strip()
    if raw == "":
        return 120_000
    if raw.lower() in ("none", "0", "unlimited"):
        return None
    try:
        return max(1, int(raw))
    except ValueError:
        return 120_000


# ---------------------------------------------------------------------------
# Provider factory — the single dispatch point
# ---------------------------------------------------------------------------


def _build_provider(slot: FlashProSlot, temperature: float, max_tokens: int) -> LlmProvider:
    """Instantiate the correct LlmProvider for *slot*.

    This is the only place in the codebase that branches on ``slot.provider``.
    All four ``generate_*`` functions call this and then use the uniform
    ``run_with_continuation`` loop.
    """
    if slot.provider == "openrouter":
        import functools

        import utils.openrouter_client as _or

        call_fn = functools.partial(
            lambda msgs, temp, mot: _or.chat_completion_with_meta(
                api_key=slot.api_key,
                model=slot.model,
                messages=msgs,
                temperature=temp,
                max_tokens=mot,
            )
        )
        return OpenAICompatProvider(provider_name="openrouter", call_fn=call_fn)

    if slot.provider == "qwen":
        import functools

        import utils.dashscope_client as _ds

        _api_base = _qwen_api_base(slot)
        call_fn = functools.partial(
            lambda msgs, temp, mot: _ds.chat_completion_with_meta(
                api_key=slot.api_key,
                api_base=_api_base,
                model=slot.model,
                messages=msgs,
                temperature=temp,
                max_tokens=mot,
            )
        )
        return OpenAICompatProvider(provider_name="qwen", call_fn=call_fn)

    if slot.provider == "bedrock":
        # Bedrock uses its own continuation loop via converse_messages directly;
        # wrap it as a minimal LlmProvider so run_with_continuation can drive it.
        from utils.bedrock_converse import converse_messages, parts_to_bedrock_content

        class _BedrockProvider(LlmProvider):
            provider_name = "bedrock"

            def text_call(
                self, messages: list[dict[str, Any]], *, temperature: float, max_tokens: int
            ) -> tuple[str, bool]:
                # Convert OpenAI-format string content → Bedrock content blocks.
                bedrock_messages: list[dict[str, Any]] = []
                for m in messages:
                    role = m.get("role", "user")
                    c = m.get("content", "")
                    content = [{"text": c}] if isinstance(c, str) else c
                    bedrock_messages.append({"role": role, "content": content})
                return converse_messages(
                    slot,
                    messages=bedrock_messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

            def vision_call(
                self, parts: list[Any], *, temperature: float, max_tokens: int
            ) -> tuple[str, bool]:
                blocks = parts_to_bedrock_content(parts)
                return converse_messages(
                    slot,
                    messages=[{"role": "user", "content": blocks}],
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

        return _BedrockProvider()

    if slot.provider == "claude":
        from utils.providers.anthropic_provider import AnthropicProvider

        return AnthropicProvider(api_key=slot.api_key, model=slot.model)

    # Default: Gemini
    gen_config = types.GenerateContentConfig(
        temperature=temperature, max_output_tokens=max_tokens
    )
    return GeminiProvider(api_key=slot.api_key, model=slot.model, gen_config=gen_config)


# ---------------------------------------------------------------------------
# LangSmith tracing helpers
# ---------------------------------------------------------------------------


def _tracing_enabled_for_llm() -> bool:
    v = (
        os.environ.get("LANGSMITH_TRACING_V2") or os.environ.get("LANGCHAIN_TRACING_V2") or ""
    ).strip().lower()
    if v not in ("true", "1"):
        return False
    key = (
        os.environ.get("LANGSMITH_API_KEY") or os.environ.get("LANGCHAIN_API_KEY") or ""
    ).strip()
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


def _run_with_optional_trace(
    *,
    provider: str,
    meta: LlmCallMeta | None,
    contents_for_hash: str | list[Any],
    fn: Any,
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


# ---------------------------------------------------------------------------
# Public generation API
# ---------------------------------------------------------------------------


def generate_flash(
    prompt: str,
    *,
    preset: FlashPreset,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    meta: LlmCallMeta | None = None,
    out_warnings: list[str] | None = None,
) -> str:
    """Generate text with the Flash-tier model for *preset*."""
    slot = _resolve_flash_slot(meta, preset)
    temp = temperature if temperature is not None else _FLASH_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else _max_output_for_flash_slot(slot)
    node = meta.node if meta else "flash"
    provider = _build_provider(slot, temp, mot)

    def _fn() -> str:
        return run_with_continuation(
            provider,
            call_type="text",
            initial_input=prompt,
            temperature=temp,
            max_tokens=mot,
            node=node,
            out_warnings=out_warnings,
            max_continuation_rounds=_max_continuation_rounds(),
        )

    return _run_with_optional_trace(
        provider=slot.provider,
        meta=meta,
        contents_for_hash=prompt,
        fn=_fn,
        empty_error=f"{slot.provider} Flash returned empty response",
    )


def generate_pro(
    prompt: str,
    *,
    preset: ProPreset,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    meta: LlmCallMeta | None = None,
    out_warnings: list[str] | None = None,
) -> str:
    """Generate text with the Pro-tier model for *preset*."""
    slot = _resolve_pro_slot(meta, preset)
    temp = temperature if temperature is not None else _PRO_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else _max_output_for_pro_slot(slot)
    node = meta.node if meta else "pro"
    provider = _build_provider(slot, temp, mot)

    def _fn() -> str:
        return run_with_continuation(
            provider,
            call_type="text",
            initial_input=prompt,
            temperature=temp,
            max_tokens=mot,
            node=node,
            out_warnings=out_warnings,
            max_continuation_rounds=_max_continuation_rounds(),
        )

    return _run_with_optional_trace(
        provider=slot.provider,
        meta=meta,
        contents_for_hash=prompt,
        fn=_fn,
        empty_error=f"{slot.provider} Pro returned empty response",
    )


def _pil_open(path: Path | str) -> Any:
    from PIL import Image

    p = Path(path) if isinstance(path, str) else path
    return Image.open(p).convert("RGB")


def build_labeled_image_parts(
    labeled_pages: list[tuple[int, Path]],
    *,
    preamble: str = "",
    closing: str = "",
) -> list[Any]:
    """Interleave explicit page labels with images to reduce page-number hallucination.

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
    meta: LlmCallMeta | None = None,
    out_warnings: list[str] | None = None,
) -> str:
    """Multimodal Flash (images + text parts)."""
    slot = _resolve_flash_slot(meta, preset)
    temp = temperature if temperature is not None else _FLASH_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else _max_output_for_flash_slot(slot)
    node = meta.node if meta else "flash"
    provider = _build_provider(slot, temp, mot)

    def _fn() -> str:
        return run_with_continuation(
            provider,
            call_type="vision",
            initial_input=parts,
            temperature=temp,
            max_tokens=mot,
            node=node,
            out_warnings=out_warnings,
            max_continuation_rounds=_max_continuation_rounds(),
        )

    return _run_with_optional_trace(
        provider=slot.provider,
        meta=meta,
        contents_for_hash=parts,
        fn=_fn,
        empty_error=f"{slot.provider} Flash returned empty response (vision)",
    )


def generate_pro_vision(
    parts: list[Any],
    *,
    preset: ProPreset = "pro_extract",
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    meta: LlmCallMeta | None = None,
    out_warnings: list[str] | None = None,
) -> str:
    """Multimodal Pro (images + text parts)."""
    slot = _resolve_pro_slot(meta, preset)
    temp = temperature if temperature is not None else _PRO_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else _max_output_for_pro_slot(slot)
    node = meta.node if meta else "pro"
    provider = _build_provider(slot, temp, mot)

    def _fn() -> str:
        return run_with_continuation(
            provider,
            call_type="vision",
            initial_input=parts,
            temperature=temp,
            max_tokens=mot,
            node=node,
            out_warnings=out_warnings,
            max_continuation_rounds=_max_continuation_rounds(),
        )

    return _run_with_optional_trace(
        provider=slot.provider,
        meta=meta,
        contents_for_hash=parts,
        fn=_fn,
        empty_error=f"{slot.provider} Pro returned empty response (vision)",
    )
