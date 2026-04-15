"""AnthropicProvider: LlmProvider implementation for Anthropic Claude models.

Uses the official ``anthropic`` SDK (via ``utils.anthropic_client``) with
tenacity rate-limit retries (up to 5 attempts), matching the pattern used by
``OpenAICompatProvider`` for OpenRouter and Qwen.
"""

from __future__ import annotations

import logging
from typing import Any

from utils.providers.base import LlmProvider

log = logging.getLogger(__name__)


class AnthropicProvider(LlmProvider):
    """LLM provider for Anthropic Claude models.

    Rate-limit retries (up to 5 attempts, 8 s base, exponential + jitter,
    Retry-After header respected) are handled inside each call via tenacity.

    Args:
        api_key: Anthropic API key (plain text, decrypted by the web BFF).
        model: Anthropic model ID, e.g. ``"claude-3-5-sonnet-20241022"``.
    """

    provider_name = "claude"

    def __init__(self, *, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model
        from utils.retry import make_rate_limit_retry

        self._rate_limit_retry = make_rate_limit_retry(5)

    def text_call(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, bool]:
        import utils.anthropic_client as _ac

        @self._rate_limit_retry
        def _do() -> tuple[str, bool]:
            return _ac.chat_completion_with_meta(
                api_key=self._api_key,
                model=self._model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        return _do()

    def vision_call(
        self,
        parts: list[Any],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, bool]:
        import utils.anthropic_client as _ac

        messages = _ac.parts_to_anthropic_messages(parts)
        return self.text_call(messages, temperature=temperature, max_tokens=max_tokens)
