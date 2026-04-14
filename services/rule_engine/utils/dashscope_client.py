"""Alibaba Bailian / DashScope OpenAI-compatible API (Qwen)."""

from __future__ import annotations

import base64
import io
import os
from typing import Any

import httpx

DEFAULT_COMPATIBLE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"


def resolve_dashscope_api_base(raw: str | None) -> str:
    """Base URL without trailing slash; from BFF credential (``dashscopeCompatibleBase``)."""
    t = (raw or "").strip().rstrip("/")
    return t or DEFAULT_COMPATIBLE_BASE


def _timeout_s() -> float:
    try:
        from utils.ai_gateway import get_extraction_runtime

        o = get_extraction_runtime()
        if o is not None and o.dashscope_http_timeout_ms is not None:
            ms = int(o.dashscope_http_timeout_ms)
            if ms <= 0:
                return 300.0
            return max(1.0, ms / 1000.0)
    except RuntimeError:
        pass
    raw = (os.environ.get("DASHSCOPE_HTTP_TIMEOUT_MS") or "").strip()
    if raw == "":
        return 120.0
    if raw.lower() in ("none", "0", "unlimited"):
        return 300.0
    try:
        return max(1.0, int(raw) / 1000.0)
    except ValueError:
        return 120.0


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _message_content_to_text(msg: dict[str, Any]) -> str:
    content = msg.get("content")
    if content is None or (isinstance(content, str) and not content.strip()):
        raise RuntimeError("DashScope returned empty response")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for p in content:
            if isinstance(p, dict) and p.get("type") == "text":
                parts.append(str(p.get("text", "")))
            elif isinstance(p, str):
                parts.append(p)
        text = "".join(parts).strip()
        if not text:
            raise RuntimeError("DashScope returned empty response")
        return text
    return str(content)


def chat_completion_with_meta(
    *,
    api_key: str,
    api_base: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    """Returns ``(text, is_truncated)``.

    ``is_truncated`` is ``True`` when ``finish_reason == "length"``, indicating the
    model hit the output token limit and a continuation call may be needed.
    """
    base = resolve_dashscope_api_base(api_base)
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    with httpx.Client(timeout=_timeout_s()) as client:
        r = client.post(url, headers=_headers(api_key), json=payload)
        r.raise_for_status()
        data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("DashScope returned no choices")
    ch0 = choices[0]
    msg = ch0.get("message") or {}
    text = _message_content_to_text(msg)
    fr = ch0.get("finish_reason")
    truncated = isinstance(fr, str) and fr.lower() == "length"
    return text, truncated


def chat_completion(
    *,
    api_key: str,
    api_base: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> str:
    text, _ = chat_completion_with_meta(
        api_key=api_key,
        api_base=api_base,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return text


def chat_completion_text(
    *,
    api_key: str,
    api_base: str,
    model: str,
    user_text: str,
    temperature: float,
    max_tokens: int,
) -> str:
    return chat_completion(
        api_key=api_key,
        api_base=api_base,
        model=model,
        messages=[{"role": "user", "content": user_text}],
        temperature=temperature,
        max_tokens=max_tokens,
    )


def chat_completion_text_with_meta(
    *,
    api_key: str,
    api_base: str,
    model: str,
    user_text: str,
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    return chat_completion_with_meta(
        api_key=api_key,
        api_base=api_base,
        model=model,
        messages=[{"role": "user", "content": user_text}],
        temperature=temperature,
        max_tokens=max_tokens,
    )


def _pil_to_data_url(img: Any) -> str:
    from PIL import Image

    if not isinstance(img, Image.Image):
        raise TypeError("expected PIL Image")
    rgb = img.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=88)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def parts_to_dashscope_messages(parts: list[Any]) -> list[dict[str, Any]]:
    """Multimodal user message (OpenAI-compatible vision format)."""
    from PIL import Image

    content: list[dict[str, Any]] = []
    for p in parts:
        if isinstance(p, str):
            content.append({"type": "text", "text": p})
        elif isinstance(p, Image.Image):
            content.append({"type": "image_url", "image_url": {"url": _pil_to_data_url(p)}})
        else:
            content.append({"type": "text", "text": str(p)})
    return [{"role": "user", "content": content}]


def chat_completion_from_parts(
    *,
    api_key: str,
    api_base: str,
    model: str,
    parts: list[Any],
    temperature: float,
    max_tokens: int,
) -> str:
    messages = parts_to_dashscope_messages(parts)
    return chat_completion(
        api_key=api_key,
        api_base=api_base,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )


def chat_completion_from_parts_with_meta(
    *,
    api_key: str,
    api_base: str,
    model: str,
    parts: list[Any],
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    messages = parts_to_dashscope_messages(parts)
    return chat_completion_with_meta(
        api_key=api_key,
        api_base=api_base,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
