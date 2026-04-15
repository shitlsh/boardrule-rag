"""Anthropic API client (Messages API via official SDK).

Wraps ``anthropic.Anthropic`` to expose the same
``chat_completion_with_meta(messages, temperature, max_tokens) -> (str, bool)``
interface as ``openrouter_client`` and ``dashscope_client``, so it can be
consumed by ``OpenAICompatProvider`` (via a custom call_fn) or directly.

OpenAI-format messages are translated to Anthropic format:
- A leading ``{"role": "system", "content": "..."}`` message is promoted to
  the top-level ``system`` parameter; multiple system messages are joined.
- All other messages keep their ``role`` / ``content`` shape (Anthropic uses the
  same ``user`` / ``assistant`` roles for the ``messages`` array).

Vision: PIL images are converted to Anthropic base64 image blocks.
"""

from __future__ import annotations

import base64
import io
import os
from typing import Any

ANTHROPIC_API_URL = "https://api.anthropic.com"
ANTHROPIC_VERSION = "2023-06-01"


def _timeout_s() -> float:
    """Return the HTTP timeout in seconds.

    Priority order:
    1. ``ExtractionRuntimeOverrides.claude_http_timeout_ms`` from the request context.
    2. ``CLAUDE_HTTP_TIMEOUT_MS`` environment variable.
    3. Hard-coded default of 120 s.
    """
    try:
        from utils.ai_gateway import get_extraction_runtime

        o = get_extraction_runtime()
        if o is not None and o.claude_http_timeout_ms is not None:
            ms = int(o.claude_http_timeout_ms)
            if ms <= 0:
                return 300.0
            return max(1.0, ms / 1000.0)
    except RuntimeError:
        pass
    raw = (os.environ.get("CLAUDE_HTTP_TIMEOUT_MS") or "").strip()
    if raw == "":
        return 120.0
    if raw.lower() in ("none", "0", "unlimited"):
        return 300.0
    try:
        return max(1.0, int(raw) / 1000.0)
    except ValueError:
        return 120.0


def _split_system(
    messages: list[dict[str, Any]],
) -> tuple[str | None, list[dict[str, Any]]]:
    """Extract leading system message(s) into a single string.

    Returns ``(system_text_or_None, remaining_messages)``.
    """
    system_parts: list[str] = []
    rest: list[dict[str, Any]] = []
    for m in messages:
        if m.get("role") == "system":
            c = m.get("content", "")
            if isinstance(c, str):
                system_parts.append(c)
            elif isinstance(c, list):
                for part in c:
                    if isinstance(part, dict) and part.get("type") == "text":
                        system_parts.append(str(part.get("text", "")))
        else:
            rest.append(m)
    return ("\n\n".join(filter(None, system_parts)) or None), rest


def _pil_to_anthropic_image_block(img: Any) -> dict[str, Any]:
    """Convert a PIL Image to an Anthropic base64 image content block."""
    from PIL import Image

    if not isinstance(img, Image.Image):
        raise TypeError(f"Expected PIL Image, got {type(img)}")
    rgb = img.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=88)
    data = base64.standard_b64encode(buf.getvalue()).decode("ascii")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": data},
    }


def _convert_openai_messages(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert OpenAI-format messages to Anthropic ``messages`` list format.

    OpenAI ``content`` can be a string or a list of content parts.  Anthropic
    expects the same shape for text parts (``{"type": "text", "text": "..."}``),
    so list-format content is forwarded as-is when it only contains text/image
    blocks already in Anthropic format.  String content is wrapped in a single
    ``{"type": "text", ...}`` block.
    """
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role", "user")
        c = m.get("content", "")
        if isinstance(c, str):
            content: list[dict[str, Any]] = [{"type": "text", "text": c}]
        elif isinstance(c, list):
            content = []
            for part in c:
                if isinstance(part, dict):
                    ptype = part.get("type", "")
                    if ptype == "text":
                        content.append({"type": "text", "text": str(part.get("text", ""))})
                    elif ptype == "image_url":
                        # Passthrough: already an image_url block (unlikely for anthropic but safe)
                        url = part.get("image_url", {}).get("url", "")
                        if url.startswith("data:image/"):
                            media, b64 = url.split(";base64,", 1)
                            media_type = media.replace("data:", "")
                            content.append({
                                "type": "image",
                                "source": {"type": "base64", "media_type": media_type, "data": b64},
                            })
                        else:
                            content.append({"type": "text", "text": url})
                    else:
                        content.append(part)
                else:
                    content.append({"type": "text", "text": str(part)})
        else:
            content = [{"type": "text", "text": str(c)}]
        out.append({"role": role, "content": content})
    return out


def parts_to_anthropic_messages(parts: list[Any]) -> list[dict[str, Any]]:
    """Convert interleaved ``str`` / PIL Image parts to a single user message."""
    content: list[dict[str, Any]] = []
    for p in parts:
        if isinstance(p, str):
            content.append({"type": "text", "text": p})
        else:
            try:
                content.append(_pil_to_anthropic_image_block(p))
            except TypeError:
                content.append({"type": "text", "text": str(p)})
    return [{"role": "user", "content": content}]


def chat_completion_with_meta(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    """Call the Anthropic Messages API and return ``(text, is_truncated)``.

    ``is_truncated`` is ``True`` when ``stop_reason == "max_tokens"``, meaning
    the model hit the output-token limit and a continuation call may be needed.
    """
    import anthropic

    system, user_messages = _split_system(messages)
    anthropic_messages = _convert_openai_messages(user_messages)

    client = anthropic.Anthropic(
        api_key=api_key,
        base_url=ANTHROPIC_API_URL,
        timeout=_timeout_s(),
    )

    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": anthropic_messages,
    }
    if system:
        kwargs["system"] = system

    response = client.messages.create(**kwargs)

    # Extract text from content blocks.
    parts: list[str] = []
    for block in response.content:
        if hasattr(block, "text"):
            parts.append(block.text)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))

    text = "".join(parts)
    if not text.strip():
        raise RuntimeError("Anthropic returned empty response")

    is_truncated = response.stop_reason == "max_tokens"
    return text, is_truncated
