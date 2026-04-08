"""Request-scoped LLM runtime from BFF ``X-Boardrule-Ai-Config`` header (no env defaults)."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

_CTX: ContextVar["BoardruleAiConfig | None"] = ContextVar("boardrule_ai_config", default=None)


class FlashProSlot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    api_key: str = Field(..., alias="apiKey")
    model: str
    max_output_tokens: int | None = Field(None, alias="maxOutputTokens")


class EmbedSlot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    api_key: str = Field(..., alias="apiKey")
    model: str


class ChatSlot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    api_key: str = Field(..., alias="apiKey")
    model: str
    temperature: float = 0.2
    max_tokens: int = Field(8192, alias="maxTokens")


class GeminiBundle(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    flash: FlashProSlot
    pro: FlashProSlot
    embed: EmbedSlot
    chat: ChatSlot


class BoardruleAiConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version: int = 1
    gemini: GeminiBundle


def get_config() -> BoardruleAiConfig:
    c = _CTX.get()
    if c is None:
        raise RuntimeError("Boardrule AI config is not set (X-Boardrule-Ai-Config)")
    return c


def get_gemini() -> GeminiBundle:
    return get_config().gemini


def parse_boardrule_ai_header(raw: str | None) -> BoardruleAiConfig | None:
    if not raw or not raw.strip():
        return None
    return BoardruleAiConfig.model_validate_json(raw.strip())


@contextmanager
def boardrule_ai_runtime(data: dict[str, Any] | BoardruleAiConfig):
    if isinstance(data, BoardruleAiConfig):
        cfg = data
    else:
        cfg = BoardruleAiConfig.model_validate(data)
    token = _CTX.set(cfg)
    try:
        yield cfg
    finally:
        _CTX.reset(token)


def reset_context(token: Token | None) -> None:
    if token is not None:
        _CTX.reset(token)


def set_context(cfg: BoardruleAiConfig) -> Token:
    return _CTX.set(cfg)
