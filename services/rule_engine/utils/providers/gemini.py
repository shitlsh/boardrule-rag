"""GeminiProvider: wraps google-genai SDK with rate-limit retry."""

from __future__ import annotations

import io
import logging
from typing import Any

from google.genai import types

from utils.providers.base import LlmProvider

log = logging.getLogger(__name__)


def _gemini_finish_truncated(fr: Any) -> bool:
    """Return True when the finish reason indicates an output-token truncation."""
    if fr is None:
        return False
    if fr == types.FinishReason.MAX_TOKENS:
        return True
    name = getattr(fr, "name", None)
    if name == "MAX_TOKENS":
        return True
    return "MAX_TOKENS" in str(fr).upper()


def _mixed_parts_to_gemini_content(parts: list[Any]) -> types.Content:
    """Convert a list of str / PIL.Image to a Gemini ``Content`` (user role)."""
    gp: list[types.Part] = []
    for p in parts:
        if isinstance(p, str):
            gp.append(types.Part(text=p))
        else:
            # Assume PIL.Image
            try:
                from PIL import Image as _PILImage

                if isinstance(p, _PILImage.Image):
                    buf = io.BytesIO()
                    p.convert("RGB").save(buf, format="PNG")
                    gp.append(
                        types.Part(
                            inline_data=types.Blob(
                                data=buf.getvalue(), mime_type="image/png"
                            )
                        )
                    )
                    continue
            except ImportError:
                pass
            gp.append(types.Part(text=str(p)))
    return types.Content(role="user", parts=gp)


def _openai_messages_to_gemini_contents(
    messages: list[dict[str, Any]],
) -> list[types.Content]:
    """Convert OpenAI-format message dicts to Gemini ``Content`` objects."""
    contents: list[types.Content] = []
    for m in messages:
        role = m.get("role", "user")
        # Gemini only accepts "user" / "model"; map "assistant" → "model".
        gemini_role = "model" if role == "assistant" else "user"
        content = m.get("content", "")
        if isinstance(content, str):
            contents.append(
                types.Content(role=gemini_role, parts=[types.Part(text=content)])
            )
        elif isinstance(content, list):
            # Multimodal content blocks — extract text parts only (images
            # are not re-sent in continuation rounds).
            text = " ".join(
                str(b.get("text", ""))
                for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            )
            contents.append(
                types.Content(role=gemini_role, parts=[types.Part(text=text)])
            )
        else:
            contents.append(
                types.Content(
                    role=gemini_role, parts=[types.Part(text=str(content))]
                )
            )
    return contents


class GeminiProvider(LlmProvider):
    """LLM provider backed by the google-genai SDK.

    Rate-limit retries (up to 5 attempts, 8 s base, exponential + jitter,
    Retry-After header respected) are handled inside each call via tenacity.
    """

    provider_name = "gemini"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        gen_config: types.GenerateContentConfig,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._gen_config = gen_config
        # Build the retry decorator once and reuse across calls.
        from utils.retry import make_rate_limit_retry

        self._rate_limit_retry = make_rate_limit_retry(5)

    def _make_client(self):
        """Construct a genai client respecting the per-request timeout setting."""
        from google import genai

        # Import lazily to avoid circular imports at module load time.
        from utils.llm_generate import _gemini_http_timeout_ms  # type: ignore[attr-defined]

        timeout_ms = _gemini_http_timeout_ms()
        if timeout_ms is None:
            return genai.Client(api_key=self._api_key)
        return genai.Client(
            api_key=self._api_key,
            http_options=types.HttpOptions(timeout=timeout_ms),
        )

    def _raw_call(self, contents: Any) -> tuple[str, bool]:
        """Single generate_content call with inner rate-limit retry."""

        @self._rate_limit_retry
        def _do() -> tuple[str, bool]:
            client = self._make_client()
            resp = client.models.generate_content(
                model=self._model,
                contents=contents,
                config=self._gen_config,
            )
            if not resp.text:
                raise RuntimeError("Gemini returned empty response")
            fr = resp.candidates[0].finish_reason if resp.candidates else None
            return resp.text, _gemini_finish_truncated(fr)

        return _do()

    def text_call(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, bool]:
        contents = _openai_messages_to_gemini_contents(messages)
        return self._raw_call(contents)

    def vision_call(
        self,
        parts: list[Any],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, bool]:
        content = _mixed_parts_to_gemini_content(parts)
        return self._raw_call([content])
