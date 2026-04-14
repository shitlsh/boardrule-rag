"""Paths relative to the rule_engine service root."""

from __future__ import annotations

import os
from pathlib import Path

_SERVICE_ROOT = Path(__file__).resolve().parent.parent


def service_root() -> Path:
    return _SERVICE_ROOT


def page_assets_root() -> Path:
    """Root directory for all page-asset data, organised as ``{game_id}/``."""
    raw = os.environ.get("PAGE_ASSETS_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    return _SERVICE_ROOT / "data" / "pages"


def game_dir(game_id: str) -> Path:
    """``{page_assets_root}/{game_id}/`` — flat dir: PNGs + page_job.json + extract.json."""
    return page_assets_root() / game_id


def game_page_job_json(game_id: str) -> Path:
    """``{game_dir}/page_job.json`` — latest page-job metadata (page_rows, page_job_id, source_name)."""
    return game_dir(game_id) / "page_job.json"


def game_extract_json(game_id: str) -> Path:
    """``{game_dir}/extract.json`` — latest extract-job state + result."""
    return game_dir(game_id) / "extract.json"


def prompts_dir() -> Path:
    return _SERVICE_ROOT / "prompts"


def load_prompt(name: str) -> str:
    path = prompts_dir() / name
    return path.read_text(encoding="utf-8")
