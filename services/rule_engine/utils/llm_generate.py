"""Slot-based LLM generation (Flash / Pro, text + vision).

Routes to **Gemini**, **OpenRouter**, or **Qwen (DashScope)** per ``X-Boardrule-Ai-Config``
(see ``utils/ai_gateway.py``). Supports optional **continuation** when the model hits
output length limits.

When LangSmith tracing is enabled, optional :class:`LlmCallMeta` attaches metadata to a child ``llm`` run.
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
from utils.ai_gateway import (
    BoardruleAiConfigV3,
    FlashProSlot,
    SlotsBundleV3,
    get_config,
    get_extraction_runtime,
    get_slots,
)
from utils.dashscope_client import resolve_dashscope_api_base
from utils.bedrock_converse import converse_messages, parts_to_bedrock_content
from utils.openrouter_client import chat_completion_with_meta

# Preset names (use at call sites to avoid magic strings)
FLASH_TOC = "flash_toc"
FLASH_QUICKSTART = "flash_quickstart"
PRO_EXTRACT = "pro_extract"
PRO_MERGE = "pro_merge"

FlashPreset = Literal["flash_toc", "flash_quickstart"]
ProPreset = Literal["pro_extract", "pro_merge"]

# Default max output tokens when BFF omits maxOutputTokens (raised from legacy 8192 for long zh rulebooks).
_DEFAULT_SLOT_MAX_OUTPUT = 32768
_ENV_PRO_DEFAULT = "BOARDRULE_PRO_MAX_OUTPUT_TOKENS_DEFAULT"
_ENV_FLASH_DEFAULT = "BOARDRULE_FLASH_MAX_OUTPUT_TOKENS_DEFAULT"
_ENV_MAX_CONTINUATION = "BOARDRULE_LLM_MAX_CONTINUATION_ROUNDS"

CONTINUE_MSG = (
    "【续写】上文为你的部分输出（末尾可能不完整）。"
    "请仅输出后续内容，从截断处紧接续写，不要重复已给出的段落，"
    "保持原有 Markdown 结构与标题层级一致。"
)


@dataclass(frozen=True)
class LlmCallMeta:
    """Per-call metadata for LangSmith (optional; see module docstring)."""

    node: str
    prompt_file: str | None = None
    prompt_sha256: str | None = None
    call_tag: str | None = None


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


def _gemini_finish_truncated(fr: Any) -> bool:
    if fr is None:
        return False
    if fr == types.FinishReason.MAX_TOKENS:
        return True
    name = getattr(fr, "name", None)
    if name == "MAX_TOKENS":
        return True
    s = str(fr).upper()
    return "MAX_TOKENS" in s


def _openai_finish_truncated(fr: str | None) -> bool:
    if not fr:
        return False
    return fr.lower() == "length"


def _append_continuation_warnings(
    out_warnings: list[str] | None,
    *,
    node: str,
    continuation_calls: int,
    still_truncated: bool,
) -> None:
    if out_warnings is None:
        return
    if continuation_calls > 0:
        out_warnings.append(
            f"llm ({node}): output hit max length; performed {continuation_calls} continuation request(s)"
        )
    if still_truncated:
        out_warnings.append(
            f"llm ({node}): output still truncated after continuation; text may be incomplete"
        )


def _gemini_generate_with_meta(
    *,
    api_key: str,
    model: str,
    contents: str | list[Any],
    gen_config: types.GenerateContentConfig,
    empty_error: str,
) -> tuple[str, Any]:
    client = _genai_client(api_key)
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=gen_config,
    )
    if not response.text:
        raise RuntimeError(empty_error)
    fr = None
    if response.candidates:
        fr = response.candidates[0].finish_reason
    return response.text, fr


def _mixed_parts_to_user_content(parts: list[Any]) -> types.Content:
    gp: list[types.Part] = []
    for p in parts:
        if isinstance(p, str):
            gp.append(types.Part(text=p))
        else:
            from PIL import Image

            if isinstance(p, Image.Image):
                import io

                buf = io.BytesIO()
                p.convert("RGB").save(buf, format="PNG")
                gp.append(types.Part(inline_data=types.Blob(data=buf.getvalue(), mime_type="image/png")))
            else:
                gp.append(types.Part(text=str(p)))
    return types.Content(role="user", parts=gp)


def _gemini_text_with_continuation(
    *,
    api_key: str,
    model: str,
    prompt: str,
    gen_config: types.GenerateContentConfig,
    empty_error: str,
    node: str,
    out_warnings: list[str] | None,
) -> str:
    max_r = _max_continuation_rounds()
    acc = ""
    history: list[types.Content] | None = None
    last_truncated = False
    for r in range(max_r):
        contents_in: str | list[Any] = prompt if r == 0 else (history or [])
        text, fr = _gemini_generate_with_meta(
            api_key=api_key,
            model=model,
            contents=contents_in,
            gen_config=gen_config,
            empty_error=empty_error,
        )
        acc += text
        last_truncated = _gemini_finish_truncated(fr)
        if not last_truncated:
            _append_continuation_warnings(out_warnings, node=node, continuation_calls=r, still_truncated=False)
            return acc
        if history is None:
            history = [
                types.Content(role="user", parts=[types.Part(text=prompt)]),
                types.Content(role="model", parts=[types.Part(text=text)]),
                types.Content(role="user", parts=[types.Part(text=CONTINUE_MSG)]),
            ]
        else:
            history.append(types.Content(role="model", parts=[types.Part(text=text)]))
            history.append(types.Content(role="user", parts=[types.Part(text=CONTINUE_MSG)]))
    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_r - 1),
        still_truncated=last_truncated,
    )
    return acc


def _gemini_vision_with_continuation(
    *,
    api_key: str,
    model: str,
    parts: list[Any],
    gen_config: types.GenerateContentConfig,
    empty_error: str,
    node: str,
    out_warnings: list[str] | None,
) -> str:
    max_r = _max_continuation_rounds()
    acc = ""
    history: list[types.Content] | None = None
    last_truncated = False
    for r in range(max_r):
        contents_in: str | list[Any] = parts if r == 0 else (history or [])
        text, fr = _gemini_generate_with_meta(
            api_key=api_key,
            model=model,
            contents=contents_in,
            gen_config=gen_config,
            empty_error=empty_error,
        )
        acc += text
        last_truncated = _gemini_finish_truncated(fr)
        if not last_truncated:
            _append_continuation_warnings(out_warnings, node=node, continuation_calls=r, still_truncated=False)
            return acc
        if history is None:
            history = [
                _mixed_parts_to_user_content(parts),
                types.Content(role="model", parts=[types.Part(text=text)]),
                types.Content(role="user", parts=[types.Part(text=CONTINUE_MSG)]),
            ]
        else:
            history.append(types.Content(role="model", parts=[types.Part(text=text)]))
            history.append(types.Content(role="user", parts=[types.Part(text=CONTINUE_MSG)]))
    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_r - 1),
        still_truncated=last_truncated,
    )
    return acc


def _openrouter_messages_loop(
    *,
    initial_messages: list[dict[str, Any]],
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int,
    node: str,
    out_warnings: list[str] | None,
) -> str:
    max_r = _max_continuation_rounds()
    messages = [dict(m) for m in initial_messages]
    acc = ""
    last_truncated = False
    for r in range(max_r):
        text, fr = chat_completion_with_meta(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        acc += text
        last_truncated = _openai_finish_truncated(fr)
        if not last_truncated:
            _append_continuation_warnings(out_warnings, node=node, continuation_calls=r, still_truncated=False)
            return acc
        messages.append({"role": "assistant", "content": text})
        messages.append({"role": "user", "content": CONTINUE_MSG})
    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_r - 1),
        still_truncated=last_truncated,
    )
    return acc


def _dashscope_messages_loop(
    *,
    initial_messages: list[dict[str, Any]],
    api_key: str,
    api_base: str,
    model: str,
    temperature: float,
    max_tokens: int,
    node: str,
    out_warnings: list[str] | None,
) -> str:
    max_r = _max_continuation_rounds()
    messages = [dict(m) for m in initial_messages]
    acc = ""
    last_truncated = False
    for r in range(max_r):
        text, fr = _dashscope.chat_completion_with_meta(
            api_key=api_key,
            api_base=api_base,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        acc += text
        last_truncated = _openai_finish_truncated(fr)
        if not last_truncated:
            _append_continuation_warnings(out_warnings, node=node, continuation_calls=r, still_truncated=False)
            return acc
        messages.append({"role": "assistant", "content": text})
        messages.append({"role": "user", "content": CONTINUE_MSG})
    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_r - 1),
        still_truncated=last_truncated,
    )
    return acc


def _bedrock_messages_loop(
    *,
    initial_messages: list[dict[str, Any]],
    slot: Any,
    temperature: float,
    max_tokens: int,
    node: str,
    out_warnings: list[str] | None,
) -> str:
    """Bedrock Converse: ``initial_messages`` use OpenAI-style ``content`` string per message."""
    max_r = _max_continuation_rounds()
    messages: list[dict[str, Any]] = []
    for m in initial_messages:
        role = m.get("role", "user")
        c = m.get("content", "")
        if isinstance(c, str):
            content = [{"text": c}]
        else:
            content = c
        messages.append({"role": role, "content": content})
    acc = ""
    last_truncated = False
    for r in range(max_r):
        text, truncated = converse_messages(
            slot,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        acc += text
        last_truncated = truncated
        if not last_truncated:
            _append_continuation_warnings(out_warnings, node=node, continuation_calls=r, still_truncated=False)
            return acc
        messages.append({"role": "assistant", "content": [{"text": text}]})
        messages.append({"role": "user", "content": [{"text": CONTINUE_MSG}]})
    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_r - 1),
        still_truncated=last_truncated,
    )
    return acc


def _bedrock_vision_parts_loop(
    *,
    parts: list[Any],
    slot: Any,
    temperature: float,
    max_tokens: int,
    node: str,
    out_warnings: list[str] | None,
) -> str:
    max_r = _max_continuation_rounds()
    blocks = parts_to_bedrock_content(parts)
    messages: list[dict[str, Any]] = [{"role": "user", "content": blocks}]
    acc = ""
    last_truncated = False
    for r in range(max_r):
        text, truncated = converse_messages(
            slot,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        acc += text
        last_truncated = truncated
        if not last_truncated:
            _append_continuation_warnings(out_warnings, node=node, continuation_calls=r, still_truncated=False)
            return acc
        messages.append({"role": "assistant", "content": [{"text": text}]})
        messages.append({"role": "user", "content": [{"text": CONTINUE_MSG}]})
    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_r - 1),
        still_truncated=last_truncated,
    )
    return acc


def _openrouter_vision_parts_loop(
    *,
    parts: list[Any],
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int,
    node: str,
    out_warnings: list[str] | None,
) -> str:
    from utils.openrouter_client import parts_to_openrouter_messages

    max_r = _max_continuation_rounds()
    messages = parts_to_openrouter_messages(parts)
    acc = ""
    last_truncated = False
    for r in range(max_r):
        text, fr = chat_completion_with_meta(
            api_key=api_key,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        acc += text
        last_truncated = _openai_finish_truncated(fr)
        if not last_truncated:
            _append_continuation_warnings(out_warnings, node=node, continuation_calls=r, still_truncated=False)
            return acc
        messages.append({"role": "assistant", "content": text})
        messages.append({"role": "user", "content": CONTINUE_MSG})
    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_r - 1),
        still_truncated=last_truncated,
    )
    return acc


def _dashscope_vision_parts_loop(
    *,
    parts: list[Any],
    api_key: str,
    api_base: str,
    model: str,
    temperature: float,
    max_tokens: int,
    node: str,
    out_warnings: list[str] | None,
) -> str:
    from utils.dashscope_client import parts_to_dashscope_messages

    max_r = _max_continuation_rounds()
    messages = parts_to_dashscope_messages(parts)
    acc = ""
    last_truncated = False
    for r in range(max_r):
        text, fr = _dashscope.chat_completion_with_meta(
            api_key=api_key,
            api_base=api_base,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        acc += text
        last_truncated = _openai_finish_truncated(fr)
        if not last_truncated:
            _append_continuation_warnings(out_warnings, node=node, continuation_calls=r, still_truncated=False)
            return acc
        messages.append({"role": "assistant", "content": text})
        messages.append({"role": "user", "content": CONTINUE_MSG})
    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_r - 1),
        still_truncated=last_truncated,
    )
    return acc


def _run_with_optional_trace(
    *,
    provider: str,
    meta: LlmCallMeta | None,
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
    meta: LlmCallMeta | None = None,
    out_warnings: list[str] | None = None,
) -> str:
    slot = _resolve_flash_slot(meta, preset)
    temp = temperature if temperature is not None else _FLASH_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else _max_output_for_flash_slot(slot)
    node = meta.node if meta else "flash"

    if slot.provider == "openrouter":

        def _fn() -> str:
            return _openrouter_messages_loop(
                initial_messages=[{"role": "user", "content": prompt}],
                api_key=slot.api_key,
                model=slot.model,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
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
            return _dashscope_messages_loop(
                initial_messages=[{"role": "user", "content": prompt}],
                api_key=slot.api_key,
                api_base=_qwen_api_base(slot),
                model=slot.model,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
            )

        return _run_with_optional_trace(
            provider="qwen",
            meta=meta,
            contents_for_hash=prompt,
            fn=_fn_q,
            empty_error="Qwen (DashScope) Flash returned empty response",
        )

    if slot.provider == "bedrock":

        def _fn_br() -> str:
            return _bedrock_messages_loop(
                initial_messages=[{"role": "user", "content": prompt}],
                slot=slot,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
            )

        return _run_with_optional_trace(
            provider="bedrock",
            meta=meta,
            contents_for_hash=prompt,
            fn=_fn_br,
            empty_error="Bedrock (Converse) Flash returned empty response",
        )

    gen_config = types.GenerateContentConfig(temperature=temp, max_output_tokens=mot)

    def _gem() -> str:
        return _gemini_text_with_continuation(
            api_key=slot.api_key,
            model=slot.model,
            prompt=prompt,
            gen_config=gen_config,
            empty_error="Gemini Flash returned empty response",
            node=node,
            out_warnings=out_warnings,
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
    meta: LlmCallMeta | None = None,
    out_warnings: list[str] | None = None,
) -> str:
    slot = _resolve_pro_slot(meta, preset)
    temp = temperature if temperature is not None else _PRO_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else _max_output_for_pro_slot(slot)
    node = meta.node if meta else "pro"

    if slot.provider == "openrouter":

        def _fn() -> str:
            return _openrouter_messages_loop(
                initial_messages=[{"role": "user", "content": prompt}],
                api_key=slot.api_key,
                model=slot.model,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
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
            return _dashscope_messages_loop(
                initial_messages=[{"role": "user", "content": prompt}],
                api_key=slot.api_key,
                api_base=_qwen_api_base(slot),
                model=slot.model,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
            )

        return _run_with_optional_trace(
            provider="qwen",
            meta=meta,
            contents_for_hash=prompt,
            fn=_fn_q,
            empty_error="Qwen (DashScope) Pro returned empty response",
        )

    if slot.provider == "bedrock":

        def _fn_br() -> str:
            return _bedrock_messages_loop(
                initial_messages=[{"role": "user", "content": prompt}],
                slot=slot,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
            )

        return _run_with_optional_trace(
            provider="bedrock",
            meta=meta,
            contents_for_hash=prompt,
            fn=_fn_br,
            empty_error="Bedrock (Converse) Pro returned empty response",
        )

    gen_config = types.GenerateContentConfig(temperature=temp, max_output_tokens=mot)

    def _gem() -> str:
        return _gemini_text_with_continuation(
            api_key=slot.api_key,
            model=slot.model,
            prompt=prompt,
            gen_config=gen_config,
            empty_error="Gemini Pro returned empty response",
            node=node,
            out_warnings=out_warnings,
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
    meta: LlmCallMeta | None = None,
    out_warnings: list[str] | None = None,
) -> str:
    """Multimodal Flash (images + text parts)."""
    slot = _resolve_flash_slot(meta, preset)
    temp = temperature if temperature is not None else _FLASH_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else _max_output_for_flash_slot(slot)
    node = meta.node if meta else "flash"

    if slot.provider == "openrouter":

        def _fn() -> str:
            return _openrouter_vision_parts_loop(
                parts=parts,
                api_key=slot.api_key,
                model=slot.model,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
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
            return _dashscope_vision_parts_loop(
                parts=parts,
                api_key=slot.api_key,
                api_base=_qwen_api_base(slot),
                model=slot.model,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
            )

        return _run_with_optional_trace(
            provider="qwen",
            meta=meta,
            contents_for_hash=parts,
            fn=_fn_q,
            empty_error="Qwen (DashScope) Flash returned empty response (vision)",
        )

    if slot.provider == "bedrock":

        def _fn_br() -> str:
            return _bedrock_vision_parts_loop(
                parts=parts,
                slot=slot,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
            )

        return _run_with_optional_trace(
            provider="bedrock",
            meta=meta,
            contents_for_hash=parts,
            fn=_fn_br,
            empty_error="Bedrock (Converse) Flash returned empty response (vision)",
        )

    gen_config = types.GenerateContentConfig(temperature=temp, max_output_tokens=mot)

    def _gem() -> str:
        return _gemini_vision_with_continuation(
            api_key=slot.api_key,
            model=slot.model,
            parts=parts,
            gen_config=gen_config,
            empty_error="Gemini Flash returned empty response (vision)",
            node=node,
            out_warnings=out_warnings,
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
    meta: LlmCallMeta | None = None,
    out_warnings: list[str] | None = None,
) -> str:
    """Multimodal Pro (images + text parts)."""
    slot = _resolve_pro_slot(meta, preset)
    temp = temperature if temperature is not None else _PRO_PRESET_TEMP[preset]
    mot = max_output_tokens if max_output_tokens is not None else _max_output_for_pro_slot(slot)
    node = meta.node if meta else "pro"

    if slot.provider == "openrouter":

        def _fn() -> str:
            return _openrouter_vision_parts_loop(
                parts=parts,
                api_key=slot.api_key,
                model=slot.model,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
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
            return _dashscope_vision_parts_loop(
                parts=parts,
                api_key=slot.api_key,
                api_base=_qwen_api_base(slot),
                model=slot.model,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
            )

        return _run_with_optional_trace(
            provider="qwen",
            meta=meta,
            contents_for_hash=parts,
            fn=_fn_q,
            empty_error="Qwen (DashScope) Pro returned empty response (vision)",
        )

    if slot.provider == "bedrock":

        def _fn_br() -> str:
            return _bedrock_vision_parts_loop(
                parts=parts,
                slot=slot,
                temperature=temp,
                max_tokens=mot,
                node=node,
                out_warnings=out_warnings,
            )

        return _run_with_optional_trace(
            provider="bedrock",
            meta=meta,
            contents_for_hash=parts,
            fn=_fn_br,
            empty_error="Bedrock (Converse) Pro returned empty response (vision)",
        )

    gen_config = types.GenerateContentConfig(temperature=temp, max_output_tokens=mot)

    def _gem() -> str:
        return _gemini_vision_with_continuation(
            api_key=slot.api_key,
            model=slot.model,
            parts=parts,
            gen_config=gen_config,
            empty_error="Gemini Pro returned empty response (vision)",
            node=node,
            out_warnings=out_warnings,
        )

    return _run_with_optional_trace(
        provider="gemini",
        meta=meta,
        contents_for_hash=parts,
        fn=_gem,
        empty_error="Gemini Pro returned empty response (vision)",
    )


# Backward-compatible alias (older name referenced "Gemini" only).
GeminiCallMeta = LlmCallMeta
