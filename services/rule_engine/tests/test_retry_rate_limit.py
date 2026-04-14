"""Tests for rate-limit heuristics and tenacity-backed retry helpers."""

from __future__ import annotations

import pytest

from utils.retry import is_likely_rate_limit, make_rate_limit_retry, retry_after_from_exception


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


# ---------------------------------------------------------------------------
# make_rate_limit_retry tests
# ---------------------------------------------------------------------------


def test_make_rate_limit_retry_succeeds_immediately() -> None:
    """No retry needed when the function succeeds on the first attempt."""
    calls: list[int] = []

    retry_dec = make_rate_limit_retry(attempts=3)

    @retry_dec
    def _fn() -> str:
        calls.append(1)
        return "ok"

    result = _fn()
    assert result == "ok"
    assert len(calls) == 1


def test_make_rate_limit_retry_retries_on_429(monkeypatch: pytest.MonkeyPatch) -> None:
    """A 429-like error should trigger retries up to the attempt limit."""
    # Patch sleep so the test doesn't actually wait.
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _: None)

    calls: list[int] = []
    retry_dec = make_rate_limit_retry(attempts=3)

    @retry_dec
    def _fn() -> str:
        calls.append(1)
        err = RuntimeError("HTTP 429 Too Many Requests")
        raise err

    with pytest.raises(RuntimeError, match="429"):
        _fn()

    assert len(calls) == 3  # exhausted all attempts


def test_make_rate_limit_retry_does_not_retry_non_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Programming errors (TypeError, ValueError, …) must NOT be retried."""
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _: None)

    calls: list[int] = []
    retry_dec = make_rate_limit_retry(attempts=5)

    @retry_dec
    def _fn() -> str:
        calls.append(1)
        raise ValueError("bad input — programming error")

    with pytest.raises(ValueError):
        _fn()

    # Must raise on first attempt without any retry.
    assert len(calls) == 1


def test_make_rate_limit_retry_does_not_retry_generic_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Generic RuntimeErrors that are NOT rate-limit indicators must not be retried."""
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _: None)

    calls: list[int] = []
    retry_dec = make_rate_limit_retry(attempts=5)

    @retry_dec
    def _fn() -> str:
        calls.append(1)
        raise RuntimeError("some other server error")

    with pytest.raises(RuntimeError):
        _fn()

    assert len(calls) == 1


def test_make_rate_limit_retry_succeeds_after_transient_429(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Should succeed if the 429 clears before attempts are exhausted."""
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _: None)

    calls: list[int] = []
    retry_dec = make_rate_limit_retry(attempts=5)

    @retry_dec
    def _fn() -> str:
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError("HTTP 429 Too Many Requests")
        return "recovered"

    result = _fn()
    assert result == "recovered"
    assert len(calls) == 3
