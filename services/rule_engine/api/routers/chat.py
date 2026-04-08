"""Phase 3: RAG chat over per-game index (LlamaIndex QueryEngine + optional multi-turn condense)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from llama_index.core.base.llms.types import ChatMessage, MessageRole
from llama_index.core.chat_engine import CondenseQuestionChatEngine
from llama_index.core.prompts import PromptTemplate
from pydantic import BaseModel, Field

from api.deps import require_boardrule_ai
from ingestion.rulebook_query import build_rulebook_query_engine, get_chat_llm
from utils.ai_gateway import BoardruleAiConfig, boardrule_ai_runtime

router = APIRouter(tags=["chat"])

logger = logging.getLogger("boardrule.chat")

# Replaces LlamaIndex default English condense template ("Given a conversation...").
_RULEBOOK_CONDENSE_PROMPT = PromptTemplate(
    "根据下面的对话历史与玩家最新一句话，改写为一句**独立、完整**的中文问题，"
    "用于在规则书中检索；保留游戏语境与所有指代，只输出这一句问题本身，不要解释。\n\n"
    "<对话历史>\n{chat_history}\n\n"
    "<玩家最新一句>\n{question}\n\n"
    "<独立问题>\n"
)


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1)


class ChatRequest(BaseModel):
    game_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    # Prior turns only (exclude the current message); optional multi-turn condense.
    messages: list[ChatMessageIn] = Field(default_factory=list)


class SourceRef(BaseModel):
    game_id: str | None = None
    source_file: str | None = None
    pages: str | None = None
    original_page_range: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    header_path: str | None = None
    text_preview: str | None = None
    score: float | None = None


class ChatResponse(BaseModel):
    answer: str
    game_id: str
    sources: list[SourceRef]


def _serialize_sources(nodes: list[Any]) -> list[SourceRef]:
    out: list[SourceRef] = []
    for nws in nodes:
        node = getattr(nws, "node", None)
        if node is None:
            continue
        meta = getattr(node, "metadata", {}) or {}
        text = (node.get_content() or "")[:500]
        hp = meta.get("header_path")
        out.append(
            SourceRef(
                game_id=meta.get("game_id"),
                source_file=meta.get("source_file"),
                pages=str(meta.get("pages")) if meta.get("pages") is not None else None,
                original_page_range=(
                    str(meta.get("original_page_range"))
                    if meta.get("original_page_range") is not None
                    else None
                ),
                page_start=meta.get("page_start"),
                page_end=meta.get("page_end"),
                header_path=str(hp) if hp is not None and str(hp).strip() else None,
                text_preview=text or None,
                score=float(getattr(nws, "score")) if getattr(nws, "score", None) is not None else None,
            )
        )
    return out


@router.post("/chat", response_model=ChatResponse)
def chat(  # sync: LlamaIndex GoogleGenAI uses asyncio.run(); async def would nest a running loop and crash.
    body: ChatRequest,
    _ai: BoardruleAiConfig = Depends(require_boardrule_ai),
) -> ChatResponse:
    logger.info("chat handler entered game_id=%s", body.game_id)
    with boardrule_ai_runtime(_ai):
        try:
            query_engine = build_rulebook_query_engine(body.game_id)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e

        llm = get_chat_llm()

        if body.messages:
            history: list[ChatMessage] = []
            for m in body.messages:
                role = MessageRole.USER if m.role == "user" else MessageRole.ASSISTANT
                history.append(ChatMessage(role=role, content=m.content))
            # ``CondenseQuestionChatEngine`` does not support ``system_prompt`` (LlamaIndex raises
            # NotImplementedError). We pass a Chinese ``condense_question_prompt``; the final answer
            # still uses ``rulebook_query._RULE_QA_TEMPLATE`` on the condensed question.
            chat_engine = CondenseQuestionChatEngine.from_defaults(
                query_engine=query_engine,
                chat_history=history,
                llm=llm,
                condense_question_prompt=_RULEBOOK_CONDENSE_PROMPT,
            )
            out = chat_engine.chat(body.message)
            answer = out.response or ""
            nodes = list(out.source_nodes or [])
        else:
            resp = query_engine.query(body.message)
            answer = resp.response or ""
            nodes = list(resp.source_nodes or [])

    return ChatResponse(
        answer=answer,
        game_id=body.game_id,
        sources=_serialize_sources(nodes),
    )
