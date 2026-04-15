"""Retry helpers for flaky LLM API calls — backed by tenacity.

Public API (unchanged from previous version):
- ``retry(fn, *, attempts, base_delay_s)``  — generic outer retry wrapper
- ``is_likely_rate_limit(exc)``             — 429 / quota heuristic
- ``retry_after_from_exception(exc)``       — parse Retry-After header
- ``sleep_before_retry_rate_limit(...)``    — manual sleep (kept for compatibility)

New:
- ``make_rate_limit_retry(attempts)``       — tenacity decorator factory used by all providers
  for inner rate-limit retry (replaces the hand-rolled for-loop in the old GeminiProvider).
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from typing import TypeVar

from tenacity import (
    RetryCallState,
    retry_base,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)
from tenacity import retry as _tenacity_retry

T = TypeVar("T")

log = logging.getLogger(__name__)

# Outer retries wrapping each LLM call in the extraction graph.
EXTRACTION_LLM_RETRY_ATTEMPTS = 5
EXTRACTION_MERGE_SPLIT_RETRY_ATTEMPTS = 4

# Exception types that represent programming errors — should never be retried.
_NON_RETRYABLE: tuple[type[BaseException], ...] = (
    TypeError,
    ValueError,
    AttributeError,
    NotImplementedError,
)


# ---------------------------------------------------------------------------
# Rate-limit heuristics (public — tested directly)
# ---------------------------------------------------------------------------


def retry_after_from_exception(exc: BaseException) -> float | None:
    """Parse ``Retry-After`` from an ``httpx`` response attached to SDK errors, if present."""
    resp = getattr(exc, "response", None)
    if resp is None:
        return None
    headers = getattr(resp, "headers", None)
    if headers is None:
        return None
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def is_likely_rate_limit(exc: BaseException) -> bool:
    """
    Heuristic for HTTP 429 and quota-style failures across all providers.
    Works with ``google.genai.errors.APIError`` (``code`` / ``status``) and plain messages.
    """
    code = getattr(exc, "code", None)
    if code == 429:
        return True
    st = getattr(exc, "status", None)
    if isinstance(st, str) and "RESOURCE_EXHAUSTED" in st.upper():
        return True
    msg = str(exc).upper()
    if "429" in msg:
        return True
    if "RESOURCE_EXHAUSTED" in msg:
        return True
    if "TOO MANY REQUESTS" in msg:
        return True
    if "RATE LIMIT" in msg and ("EXCEED" in msg or "EXHAUST" in msg):
        return True
    return False


def sleep_before_retry_rate_limit(
    attempt_index: int,
    exc: BaseException,
    *,
    base_rate_s: float = 8.0,
    max_sleep_s: float = 120.0,
) -> None:
    """Manual backoff tuned for API quota / burst limits (kept for compatibility)."""
    ra = retry_after_from_exception(exc)
    if ra is not None and ra > 0:
        time.sleep(min(max_sleep_s, ra + random.random()))
        return
    raw = base_rate_s * (2**attempt_index) + random.uniform(0, 1.0)
    time.sleep(min(max_sleep_s, raw))


# ---------------------------------------------------------------------------
# Tenacity-based retry factories
# ---------------------------------------------------------------------------


class _RetryIfRateLimit(retry_base):
    """Tenacity retry condition: retry only on rate-limit errors, never on programming errors."""

    def __call__(self, retry_state: RetryCallState) -> bool:
        exc = retry_state.outcome.exception()
        if exc is None:
            return False
        if isinstance(exc, _NON_RETRYABLE):
            return False
        return is_likely_rate_limit(exc)


def _make_before_sleep_rate_limit(max_sleep_s: float = 120.0):
    """
    Before-sleep callback for tenacity: honours ``Retry-After`` header when present,
    otherwise lets tenacity's ``wait_exponential_jitter`` handle the delay.
    """

    def _before_sleep(retry_state: RetryCallState) -> None:
        exc = retry_state.outcome.exception()
        if exc is None:
            return
        ra = retry_after_from_exception(exc)
        if ra is not None and ra > 0:
            # Override tenacity's computed wait with the server-specified value.
            sleep_s = min(max_sleep_s, ra + random.random())
            log.debug("rate-limit retry: honouring Retry-After=%.1fs (capped %.1fs)", ra, sleep_s)
            retry_state.next_action.sleep = sleep_s  # type: ignore[union-attr]
        else:
            log.debug(
                "rate-limit retry: attempt %d, sleeping %.1fs",
                retry_state.attempt_number,
                retry_state.next_action.sleep,  # type: ignore[union-attr]
            )

    return _before_sleep


def make_rate_limit_retry(attempts: int = 5):
    """
    Return a tenacity retry decorator for inner rate-limit retries.

    Used by all providers (Gemini, OpenRouter, Qwen) to give a consistent,
    quota-aware backoff: base=8 s, exponential with jitter, capped at 120 s.
    Retry-After header is respected when present.

    Example::

        _retry = make_rate_limit_retry(5)

        @_retry
        def _do():
            return api_call(...)
    """
    return _tenacity_retry(
        retry=_RetryIfRateLimit(),
        stop=stop_after_attempt(attempts),
        wait=wait_exponential_jitter(initial=8, max=120, jitter=1),
        before_sleep=_make_before_sleep_rate_limit(),
        reraise=True,
    )


# ---------------------------------------------------------------------------
# Generic outer retry (public — used by graph nodes)
# ---------------------------------------------------------------------------


def retry(
    fn: Callable[[], T],
    *,
    attempts: int = 3,
    base_delay_s: float = 1.0,
) -> T:
    """
    Generic outer retry with exponential back-off.

    Programming errors (TypeError, ValueError, AttributeError, NotImplementedError)
    are re-raised immediately without retrying.
    """
    decorated = _tenacity_retry(
        retry=retry_if_exception(lambda e: not isinstance(e, _NON_RETRYABLE)),
        stop=stop_after_attempt(attempts),
        wait=wait_exponential_jitter(
            initial=base_delay_s,
            max=base_delay_s * (2 ** (attempts - 1)),
            jitter=0,
        ),
        reraise=True,
    )(fn)
    return decorated()
