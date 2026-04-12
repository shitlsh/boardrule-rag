"""Request-scoped LLM runtime from BFF ``X-Boardrule-Ai-Config`` header (no env defaults)."""

from __future__ import annotations

import json
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any, Literal, Union

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


class SlotsBundleV3(BaseModel):
    """v3: optional fine-grained flash/pro slots; omitted fields fall back to ``flash`` / ``pro`` in ``llm_generate``."""

    model_config = ConfigDict(populate_by_name=True)

    flash: FlashProSlot
    pro: FlashProSlot
    embed: EmbedSlot
    chat: ChatSlot
    flash_toc: FlashProSlot | None = Field(None, alias="flashToc")
    flash_quickstart: FlashProSlot | None = Field(None, alias="flashQuickstart")
    pro_extract: FlashProSlot | None = Field(None, alias="proExtract")
    pro_merge: FlashProSlot | None = Field(None, alias="proMerge")


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


class ExtractionRuntimeOverrides(BaseModel):
    """BFF / profile overrides; graph and ``llm_generate`` prefer these over process env when set."""

    model_config = ConfigDict(populate_by_name=True)

    vision_batch_pages: int | None = Field(None, alias="visionBatchPages", ge=1, le=64)
    extraction_simple_max_body_pages: int | None = Field(None, alias="extractionSimpleMaxBodyPages", ge=1, le=500)
    extraction_complex_route_body_pages: int | None = Field(
        None,
        alias="extractionComplexRouteBodyPages",
        ge=1,
        le=500,
    )
    extraction_simple_path_warn_body_pages: int | None = Field(
        None,
        alias="extractionSimplePathWarnBodyPages",
        ge=1,
        le=500,
    )
    gemini_vision_max_merge_pages: int | None = Field(None, alias="geminiVisionMaxMergePages", ge=1, le=200)
    need_more_context_max_expand: int | None = Field(None, alias="needMoreContextMaxExpand", ge=0, le=64)
    gemini_http_timeout_ms: int | None = Field(None, alias="geminiHttpTimeoutMs")
    dashscope_http_timeout_ms: int | None = Field(None, alias="dashscopeHttpTimeoutMs")
    openrouter_http_timeout_ms: int | None = Field(None, alias="openrouterHttpTimeoutMs")
    llm_max_continuation_rounds: int | None = Field(None, alias="llmMaxContinuationRounds", ge=0, le=32)
    force_full_pipeline_default: bool | None = Field(None, alias="forceFullPipelineDefault")


class BoardruleAiConfigV2(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version: Literal[2] = 2
    slots: SlotsBundle
    rag_options: RagOptions | None = Field(None, alias="ragOptions")


class BoardruleAiConfigV3(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version: Literal[3] = 3
    slots: SlotsBundleV3
    rag_options: RagOptions | None = Field(None, alias="ragOptions")
    extraction_runtime: ExtractionRuntimeOverrides | None = Field(None, alias="extractionRuntime")


BoardruleAiConfig = Union[BoardruleAiConfigV2, BoardruleAiConfigV3]


def get_config() -> BoardruleAiConfig:
    c = _CTX.get()
    if c is None:
        raise RuntimeError("Boardrule AI config is not set (X-Boardrule-Ai-Config)")
    return c


def get_slots() -> SlotsBundle | SlotsBundleV3:
    return get_config().slots


def get_extraction_runtime() -> ExtractionRuntimeOverrides | None:
    c = get_config()
    if isinstance(c, BoardruleAiConfigV3) and c.extraction_runtime is not None:
        return c.extraction_runtime
    return None


def _parse_json_obj(data: dict[str, Any]) -> BoardruleAiConfig:
    v = data.get("version")
    if v == 3:
        return BoardruleAiConfigV3.model_validate(data)
    return BoardruleAiConfigV2.model_validate(data)


def parse_boardrule_ai_header(raw: str | None) -> BoardruleAiConfig | None:
    if not raw or not raw.strip():
        return None
    data = json.loads(raw.strip())
    if not isinstance(data, dict):
        raise ValueError("X-Boardrule-Ai-Config must be a JSON object")
    return _parse_json_obj(data)


@contextmanager
def boardrule_ai_runtime(data: dict[str, Any] | BoardruleAiConfig):
    if isinstance(data, (BoardruleAiConfigV2, BoardruleAiConfigV3)):
        cfg = data
    elif isinstance(data, dict):
        cfg = _parse_json_obj(data)
    else:
        raise TypeError("boardrule_ai_runtime expects dict or BoardruleAiConfig")
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
