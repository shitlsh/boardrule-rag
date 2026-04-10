"""Stable, human-readable exception strings for API job errors (avoid KeyError's confusing ``str()``)."""

from __future__ import annotations

import traceback


def format_exception_for_job(exc: BaseException) -> str:
    """
    ``str(KeyError('uuid'))`` in Python 3 is ``"'uuid'"``, which looks like a useless id.
    Return a one-line ``KeyError: ...`` plus file/line of the failure site when traceback exists.
    """
    if isinstance(exc, KeyError):
        key = exc.args[0] if exc.args else None
        line = f"KeyError: missing key or bad lookup {key!r}"
    else:
        line = "".join(traceback.format_exception_only(type(exc), exc)).strip()
    tb = exc.__traceback__
    if tb is not None:
        frames = traceback.extract_tb(tb)
        if frames:
            last = frames[-1]
            loc = f"{last.filename}:{last.lineno} in {last.name or '<module>'}"
            return f"{line} (at {loc})"
    return line
