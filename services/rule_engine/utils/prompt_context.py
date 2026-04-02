"""Fill shared placeholders in prompt templates from extraction state."""

from __future__ import annotations

from graphs.state import ExtractionState

_DEFAULT_TERM = (
    "（暂无外部术语库注入；请按国内桌游社区通用译法翻译专有名词，"
    "首次出现时可附原文括号，例如「工人放置（Worker Placement）」。）"
)


def game_display_name(state: ExtractionState) -> str:
    g = (state.get("game_name") or state.get("game_id") or "本游戏").strip()
    return g or "本游戏"


def terminology_block(state: ExtractionState) -> str:
    """Body text that replaces {{TERM_CONTEXT}} in prompts.

    Primary source: ``state["terminology_context"]``, set from the optional
    ``terminology_context`` multipart field on ``POST /extract`` (usually filled
    by the web app or another caller with glossary / KB snippets). If missing or
    blank, returns a fixed default string so the model still sees explicit
    instructions instead of an empty block.
    """
    raw = (state.get("terminology_context") or "").strip()
    return raw if raw else _DEFAULT_TERM


def fill_prompt_placeholders(template: str, state: ExtractionState) -> str:
    """Replace ``{{GAME_NAME}}`` and ``{{TERM_CONTEXT}}`` using *state* (see README)."""
    return (
        template.replace("{{GAME_NAME}}", game_display_name(state))
        .replace("{{TERM_CONTEXT}}", terminology_block(state))
    )
