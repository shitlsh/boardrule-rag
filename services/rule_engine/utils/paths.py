"""Paths relative to the rule_engine service root."""

from __future__ import annotations

import os
from pathlib import Path

_SERVICE_ROOT = Path(__file__).resolve().parent.parent


def service_root() -> Path:
    return _SERVICE_ROOT


def page_assets_root() -> Path:
    """Directory for rasterized per-page PNGs (`{job_id}/page_0001.png`)."""
    raw = os.environ.get("PAGE_ASSETS_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    return _SERVICE_ROOT / "data" / "pages"


def prompts_dir() -> Path:
    return _SERVICE_ROOT / "prompts"


def load_prompt(name: str) -> str:
    path = prompts_dir() / name
    return path.read_text(encoding="utf-8")
