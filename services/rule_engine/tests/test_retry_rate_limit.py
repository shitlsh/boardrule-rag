"""Tests for rate-limit heuristics used by Gemini retries."""

from __future__ import annotations

from utils.retry import is_likely_rate_limit, retry_after_from_exception


class _FakeResp:
    def __init__(self, headers: dict[str, str]) -> None:
        self.headers = headers


class _Err429:
    code = 429
    status = "RESOURCE_EXHAUSTED"
    response = _FakeResp({"retry-after": "3"})


def test_is_likely_rate_limit_genai_style() -> None:
    assert is_likely_rate_limit(_Err429()) is True


def test_retry_after_from_exception() -> None:
    assert retry_after_from_exception(_Err429()) == 3.0


def test_is_likely_rate_limit_plain_message() -> None:
    assert is_likely_rate_limit(RuntimeError("HTTP 429 Too Many Requests")) is True


def test_is_likely_rate_limit_negative() -> None:
    assert is_likely_rate_limit(ValueError("bad json")) is False
