"""Request-scoped LLM runtime from BFF ``X-Boardrule-Ai-Config`` header (no env defaults)."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

_CTX: ContextVar["BoardruleAiConfig | None"] = ContextVar("boardrule_ai_config", default=None)


class FlashProSlot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: Literal["gemini", "openrouter", "qwen"]
    api_key: str = Field(..., alias="apiKey")
    model: str
    max_output_tokens: int | None = Field(None, alias="maxOutputTokens")
    dashscope_compatible_base: str | None = Field(None, alias="dashscopeCompatibleBase")


class EmbedSlot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: Literal["gemini", "openrouter", "qwen"]
    api_key: str = Field(..., alias="apiKey")
    model: str
    dashscope_compatible_base: str | None = Field(None, alias="dashscopeCompatibleBase")


class ChatSlot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: Literal["gemini", "openrouter", "qwen"]
    api_key: str = Field(..., alias="apiKey")
    model: str
    temperature: float = 0.2
    max_tokens: int = Field(8192, alias="maxTokens")
    dashscope_compatible_base: str | None = Field(None, alias="dashscopeCompatibleBase")


class SlotsBundle(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    flash: FlashProSlot
    pro: FlashProSlot
    embed: EmbedSlot
    chat: ChatSlot


class RagOptions(BaseModel):
    """Optional RAG / indexing overrides from the web AI Gateway (engine falls back to env)."""

    model_config = ConfigDict(populate_by_name=True)

    rerank_model: str | None = Field(None, alias="rerankModel")
    chunk_size: int | None = Field(None, alias="chunkSize", gt=0)
    chunk_overlap: int | None = Field(None, alias="chunkOverlap", ge=0)
    bm25_token_profile: Literal["cjk_char", "latin_word"] | None = Field(
        None,
        alias="bm25TokenProfile",
    )
    similarity_top_k: int | None = Field(None, alias="similarityTopK", ge=1, le=200)
    rerank_top_n: int | None = Field(None, alias="rerankTopN", ge=1, le=100)
    retrieval_mode: Literal["hybrid", "vector_only"] | None = Field(None, alias="retrievalMode")
    use_rerank: bool | None = Field(None, alias="useRerank")


class BoardruleAiConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version: Literal[2] = 2
    slots: SlotsBundle
    rag_options: RagOptions | None = Field(None, alias="ragOptions")


def get_config() -> BoardruleAiConfig:
    c = _CTX.get()
    if c is None:
        raise RuntimeError("Boardrule AI config is not set (X-Boardrule-Ai-Config)")
    return c


def get_slots() -> SlotsBundle:
    return get_config().slots


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
