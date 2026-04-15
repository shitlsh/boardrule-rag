"""Provider implementations for multi-model LLM dispatch.

Each provider exposes a uniform interface (``LlmProvider`` Protocol) with two methods:

- ``text_call(messages, *, temperature, max_tokens) -> (str, bool)``
- ``vision_call(parts, *, temperature, max_tokens) -> (str, bool)``

The boolean in each tuple is ``is_truncated``: ``True`` when the model hit its
output token limit and a continuation call should be made.

The generic continuation loop lives in ``base.py`` and is shared by all providers.
"""

from utils.providers.anthropic_provider import AnthropicProvider
from utils.providers.base import LlmProvider, run_with_continuation
from utils.providers.gemini import GeminiProvider
from utils.providers.openai_compat import OpenAICompatProvider

__all__ = [
    "LlmProvider",
    "run_with_continuation",
    "GeminiProvider",
    "OpenAICompatProvider",
    "AnthropicProvider",
]
