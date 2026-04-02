"""Simple retry helper for flaky API calls."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


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
