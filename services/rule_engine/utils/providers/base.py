"""Base abstractions for LLM provider dispatch.

``LlmProvider`` is a structural Protocol — providers implement it without
inheriting from a base class.  ``run_with_continuation`` is the single generic
continuation loop that replaces the seven near-identical ``*_loop`` /
``*_with_continuation`` functions that previously lived in ``llm_generate.py``.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    pass

log = logging.getLogger(__name__)

# Continuation prompt (Chinese): "resume from where the output was cut off"
CONTINUE_MSG = (
    "【续写】上文为你的部分输出（末尾可能不完整）。"
    "请仅输出后续内容，从截断处紧接续写，不要重复已给出的段落，"
    "保持原有 Markdown 结构与标题层级一致。"
)


class LlmProvider:
    """Structural interface for all LLM providers.

    Each concrete provider implements:
    - ``text_call``: pure-text multi-turn conversation (OpenAI-format messages).
    - ``vision_call``: first-round call with interleaved text + PIL images.

    Both return ``(text, is_truncated: bool)``.  The continuation loop
    (``run_with_continuation``) builds the multi-turn history and calls
    ``text_call`` for all rounds after the first vision round.

    Providers are also responsible for inner rate-limit retries
    (via ``make_rate_limit_retry`` from ``utils.retry``).
    """

    provider_name: str = "unknown"

    def text_call(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, bool]:
        raise NotImplementedError

    def vision_call(
        self,
        parts: list[Any],
        *,
        temperature: float,
        max_tokens: int,
    ) -> tuple[str, bool]:
        raise NotImplementedError


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
            f"llm ({node}): output hit max length; "
            f"performed {continuation_calls} continuation request(s)"
        )
    if still_truncated:
        out_warnings.append(
            f"llm ({node}): output still truncated after continuation; "
            "text may be incomplete"
        )


def run_with_continuation(
    provider: LlmProvider,
    *,
    call_type: Literal["text", "vision"],
    initial_input: str | list[Any],
    temperature: float,
    max_tokens: int,
    node: str,
    out_warnings: list[str] | None,
    max_continuation_rounds: int,
) -> str:
    """Generic continuation loop shared by all providers.

    Handles output truncation by sending follow-up messages when the model
    hits ``max_tokens``.  Vision images are only sent in the first round;
    subsequent rounds are text-only, keeping the full message history.

    Args:
        provider: The LLM provider to call.
        call_type: ``"text"`` for text-only prompts, ``"vision"`` for the
            first call containing images (subsequent rounds fall back to
            ``text_call``).
        initial_input: The initial prompt string (text) or list of
            str/PIL.Image parts (vision).
        temperature: Sampling temperature forwarded to the provider.
        max_tokens: Maximum output tokens forwarded to the provider.
        node: Node name used in warning messages.
        out_warnings: Optional list to append human-readable warnings to.
        max_continuation_rounds: Maximum total rounds (including the first).
    """
    # text_messages tracks the full conversation history in OpenAI format.
    # For vision: populated after the first round using the model's reply.
    text_messages: list[dict[str, Any]] | None = None
    acc = ""
    last_truncated = False

    for r in range(max_continuation_rounds):
        if r == 0:
            if call_type == "text":
                assert isinstance(initial_input, str)
                msgs: list[dict[str, Any]] = [{"role": "user", "content": initial_input}]
                text, truncated = provider.text_call(
                    msgs, temperature=temperature, max_tokens=max_tokens
                )
                # Seed history for potential continuation.
                text_messages = [
                    {"role": "user", "content": initial_input},
                    {"role": "assistant", "content": text},
                ]
            else:
                assert isinstance(initial_input, list)
                text, truncated = provider.vision_call(
                    initial_input, temperature=temperature, max_tokens=max_tokens
                )
                # After the vision round the provider converts parts to its
                # native format internally.  For continuation we fall back to
                # text_call with a plain-text history — images are not re-sent.
                text_messages = [
                    # Use a placeholder so history is non-empty; actual image
                    # content was already consumed by vision_call above.
                    {"role": "user", "content": "[vision prompt]"},
                    {"role": "assistant", "content": text},
                ]
        else:
            assert text_messages is not None
            text_messages.append({"role": "user", "content": CONTINUE_MSG})
            text, truncated = provider.text_call(
                text_messages, temperature=temperature, max_tokens=max_tokens
            )
            text_messages.append({"role": "assistant", "content": text})

        acc += text
        last_truncated = truncated

        if not truncated:
            _append_continuation_warnings(
                out_warnings,
                node=node,
                continuation_calls=r,
                still_truncated=False,
            )
            return acc

    _append_continuation_warnings(
        out_warnings,
        node=node,
        continuation_calls=max(0, max_continuation_rounds - 1),
        still_truncated=last_truncated,
    )
    return acc
