"""Paths relative to the rule_engine service root."""

from __future__ import annotations

from pathlib import Path

_SERVICE_ROOT = Path(__file__).resolve().parent.parent


def service_root() -> Path:
    return _SERVICE_ROOT


def prompts_dir() -> Path:
    return _SERVICE_ROOT / "prompts"


def load_prompt(name: str) -> str:
    path = prompts_dir() / name
    return path.read_text(encoding="utf-8")
