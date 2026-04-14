"""Simple retry helper for flaky API calls."""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

# Outer retries wrapping each LLM call in the extraction graph (in addition to inner 429 handling in
# ``llm_generate`` for Gemini). Higher than the generic default helps free-tier / burst limits.
EXTRACTION_LLM_RETRY_ATTEMPTS = 5
# merge_and_refine split-half calls (two parallel Pro calls); keep slightly lower than full-node retries.
EXTRACTION_MERGE_SPLIT_RETRY_ATTEMPTS = 4


def retry(
    fn: Callable[[], T],
    *,
    attempts: int = 3,
    base_delay_s: float = 1.0,
) -> T:
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 — intentional retry
            last = e
            if i == attempts - 1:
                raise
            time.sleep(base_delay_s * (2**i))
    assert last is not None
    raise last


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
    Heuristic for Gemini / Google GenAI HTTP 429 and quota-style failures.
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
    """Backoff tuned for API quota / burst limits (longer than generic ``retry``)."""
    ra = retry_after_from_exception(exc)
    if ra is not None and ra > 0:
        time.sleep(min(max_sleep_s, ra + random.random()))
        return
    raw = base_rate_s * (2**attempt_index) + random.uniform(0, 1.0)
    time.sleep(min(max_sleep_s, raw))
