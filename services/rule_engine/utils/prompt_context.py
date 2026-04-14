"""Jinja2 prompt rendering from ``prompts/*.md`` and extraction state."""

from __future__ import annotations

from typing import Any

from jinja2 import Environment, StrictUndefined

from graphs.state import ExtractionState
from utils.paths import load_prompt

_DEFAULT_TERM = (
    "（暂无外部术语库注入；请按国内桌游社区通用译法翻译专有名词，"
    "首次出现时可附原文括号，例如「工人放置（Worker Placement）」。）"
)

# Module-level singleton: constructing a fresh Environment on every render call
# discards the template cache.  StrictUndefined + autoescape=False matches the
# old per-call behaviour exactly.
_JINJA_ENV = Environment(undefined=StrictUndefined, autoescape=False)


def game_display_name(state: ExtractionState) -> str:
    g = (state.get("game_name") or state.get("game_id") or "本游戏").strip()
    return g or "本游戏"


def terminology_block(state: ExtractionState) -> str:
    """Body text for ``terminology_context`` in prompts.

    Primary source: ``state["terminology_context"]``, set from the optional
    ``terminology_context`` multipart field on ``POST /extract`` (usually filled
    by the web app or another caller with glossary / KB snippets). If missing or
    blank, returns a fixed default string so the model still sees explicit
    instructions instead of an empty block.
    """
    raw = (state.get("terminology_context") or "").strip()
    return raw if raw else _DEFAULT_TERM


def _base_context(state: ExtractionState) -> dict[str, Any]:
    return {
        "game_name": game_display_name(state),
        "terminology_context": terminology_block(state),
    }


def render_string(template_str: str, state: ExtractionState | None = None, **extra: Any) -> str:
    """Render an inline template string (used for small fragments)."""
    ctx: dict[str, Any] = {}
    if state is not None:
        ctx.update(_base_context(state))
    ctx.update(extra)
    return _JINJA_ENV.from_string(template_str).render(**ctx)


def render_prompt(template_name: str, state: ExtractionState | None = None, **extra: Any) -> str:
    """Load ``prompts/{template_name}`` and render with Jinja2."""
    template_str = load_prompt(template_name)
    return render_string(template_str, state, **extra)
