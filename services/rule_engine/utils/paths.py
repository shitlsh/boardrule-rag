"""Paths relative to the rule_engine service root."""

from __future__ import annotations

import os
from pathlib import Path

_SERVICE_ROOT = Path(__file__).resolve().parent.parent


def service_root() -> Path:
    return _SERVICE_ROOT


def page_assets_root() -> Path:
    """Root directory for all page-asset data, organised as ``{game_id}/pages/{page_job_id}/``."""
    raw = os.environ.get("PAGE_ASSETS_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    return _SERVICE_ROOT / "data" / "pages"


def game_pages_dir(game_id: str) -> Path:
    """``{page_assets_root}/{game_id}/pages/`` — parent of per-job image directories."""
    return page_assets_root() / game_id / "pages"


def game_page_job_json(game_id: str) -> Path:
    """``{page_assets_root}/{game_id}/pages/page_job.json`` — latest page-job metadata."""
    return game_pages_dir(game_id) / "page_job.json"


def game_extract_json(game_id: str) -> Path:
    """``{page_assets_root}/{game_id}/extract.json`` — latest extract-job metadata + result."""
    return page_assets_root() / game_id / "extract.json"


def job_index_json() -> Path:
    """``{page_assets_root}/job_index.json`` — flat map of {extract_job_id: game_id} for O(1) lookup."""
    return page_assets_root() / "job_index.json"


def prompts_dir() -> Path:
    return _SERVICE_ROOT / "prompts"


def load_prompt(name: str) -> str:
    path = prompts_dir() / name
    return path.read_text(encoding="utf-8")
