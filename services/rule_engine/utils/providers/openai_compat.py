"""OpenAICompatProvider: shared provider for OpenRouter and Qwen (DashScope).

Both services expose an OpenAI-compatible ``/chat/completions`` endpoint.
The only difference is the base URL, auth header, and a few extra headers
(OpenRouter's ``HTTP-Referer`` / ``X-Title``).  A single class handles both
by accepting a ``call_fn`` callable that wraps the appropriate client module.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from utils.providers.base import LlmProvider

log = logging.getLogger(__name__)


def _parts_to_openai_vision_messages(parts: list[Any]) -> list[dict[str, Any]]:
    """Build a single-user OpenAI-format message with interleaved text + images.

    Images are encoded as JPEG base64 data-URLs (quality 88) — identical to
    the previous ``parts_to_openrouter_messages`` / ``parts_to_dashscope_messages``
    helpers, which are still available in their respective modules for callers
    outside the provider abstraction.
    """
    import base64
    import io

    try:
        from PIL import Image as _PILImage
    except ImportError:
        _PILImage = None  # type: ignore[assignment]

    content: list[dict[str, Any]] = []
    for p in parts:
        if isinstance(p, str):
            content.append({"type": "text", "text": p})
        elif _PILImage is not None and isinstance(p, _PILImage.Image):
            rgb = p.convert("RGB")
            buf = io.BytesIO()
            rgb.save(buf, format="JPEG", quality=88)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                }
            )
        else:
            content.append({"type": "text", "text": str(p)})
    return [{"role": "user", "content": content}]


class OpenAICompatProvider(LlmProvider):
    """LLM provider for any OpenAI-compatible endpoint (OpenRouter, Qwen/DashScope…).

    Rate-limit retries (up to 5 attempts, 8 s base, exponential + jitter,
    Retry-After header respected) are handled inside each call via tenacity.

    Args:
        provider_name: Human-readable name used in logs and LangSmith traces
            (e.g. ``"openrouter"`` or ``"qwen"``).
        call_fn: A callable ``(messages, temperature, max_tokens) -> (str, bool)``
            that wraps the underlying HTTP client.  Use ``functools.partial`` to
            bind ``api_key``, ``model``, and any provider-specific parameters.
    """

    def __init__(
        self,
        *,
        provider_name: str,
        call_fn: Callable[
            [list[dict[str, Any]], float, int],
            tuple[str, bool],
        ],
    ) -> None:
        self.provider_name = provider_name
        self._call_fn = call_fn
        from utils.retry import make_rate_limit_retry

        self._rate_limit_retry = make_rate_limit_retry(5)

    def text_call(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, bool]:
        @self._rate_limit_retry
        def _do() -> tuple[str, bool]:
            return self._call_fn(messages, temperature, max_tokens)

        return _do()

    def vision_call(
        self,
        parts: list[Any],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, bool]:
        messages = _parts_to_openai_vision_messages(parts)
        return self.text_call(messages, temperature=temperature, max_tokens=max_tokens)
