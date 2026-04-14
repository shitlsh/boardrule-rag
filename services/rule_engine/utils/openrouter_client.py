"""OpenRouter OpenAI-compatible HTTP client (chat completions)."""

from __future__ import annotations

import base64
import io
import os
from typing import Any

import httpx

OPENROUTER_API_BASE = "https://openrouter.ai/api/v1"


def _timeout_s() -> float:
    try:
        from utils.ai_gateway import get_extraction_runtime

        o = get_extraction_runtime()
        if o is not None and o.openrouter_http_timeout_ms is not None:
            ms = int(o.openrouter_http_timeout_ms)
            if ms <= 0:
                return 300.0
            return max(1.0, ms / 1000.0)
    except RuntimeError:
        pass
    raw = (os.environ.get("OPENROUTER_HTTP_TIMEOUT_MS") or "").strip()
    if raw == "":
        return 120.0
    if raw.lower() in ("none", "0", "unlimited"):
        return 300.0
    try:
        return max(1.0, int(raw) / 1000.0)
    except ValueError:
        return 120.0


def _headers(api_key: str) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    ref = (os.environ.get("OPENROUTER_HTTP_REFERER") or "").strip()
    if ref:
        h["HTTP-Referer"] = ref
    title = (os.environ.get("OPENROUTER_APP_TITLE") or "boardrule-rag").strip()
    if title:
        h["X-Title"] = title
    return h


def _message_content_to_text(msg: dict[str, Any]) -> str:
    content = msg.get("content")
    if content is None or (isinstance(content, str) and not content.strip()):
        raise RuntimeError("OpenRouter returned empty response")
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
            raise RuntimeError("OpenRouter returned empty response")
        return text
    return str(content)


def chat_completion_with_meta(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    """Returns ``(text, is_truncated)``.

    ``is_truncated`` is ``True`` when ``finish_reason == "length"``, indicating the
    model hit the output token limit and a continuation call may be needed.
    """
    url = f"{OPENROUTER_API_BASE}/chat/completions"
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
        raise RuntimeError("OpenRouter returned no choices")
    ch0 = choices[0]
    msg = ch0.get("message") or {}
    text = _message_content_to_text(msg)
    fr = ch0.get("finish_reason")
    truncated = isinstance(fr, str) and fr.lower() == "length"
    return text, truncated


def chat_completion(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> str:
    text, _ = chat_completion_with_meta(
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return text


def chat_completion_text(
    *,
    api_key: str,
    model: str,
    user_text: str,
    temperature: float,
    max_tokens: int,
) -> str:
    return chat_completion(
        api_key=api_key,
        model=model,
        messages=[{"role": "user", "content": user_text}],
        temperature=temperature,
        max_tokens=max_tokens,
    )


def chat_completion_text_with_meta(
    *,
    api_key: str,
    model: str,
    user_text: str,
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    return chat_completion_with_meta(
        api_key=api_key,
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


def parts_to_openrouter_messages(parts: list[Any]) -> list[dict[str, Any]]:
    """Build one user message with interleaved text and PIL images."""
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
    model: str,
    parts: list[Any],
    temperature: float,
    max_tokens: int,
) -> str:
    messages = parts_to_openrouter_messages(parts)
    return chat_completion(
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )


def chat_completion_from_parts_with_meta(
    *,
    api_key: str,
    model: str,
    parts: list[Any],
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    messages = parts_to_openrouter_messages(parts)
    return chat_completion_with_meta(
        api_key=api_key,
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
