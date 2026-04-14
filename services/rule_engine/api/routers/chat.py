"""Phase 3: RAG chat over per-game index (LlamaIndex QueryEngine + optional multi-turn condense).

SSE streaming: ``POST /chat/stream`` emits JSON lines documented in ``apps/web/lib/chat-sse-protocol.ts``.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from llama_index.core.base.llms.types import ChatMessage, MessageRole
from llama_index.core.base.response.schema import StreamingResponse as LlamaStreamingResponse
from llama_index.core.chat_engine import CondenseQuestionChatEngine
from llama_index.core.prompts import PromptTemplate
from llama_index.core.schema import QueryBundle
from pydantic import BaseModel, Field

from api.deps import require_boardrule_ai
from ingestion.index_builder import game_index_dir
from ingestion.rulebook_query import build_rulebook_query_engine, get_chat_llm
from utils.ai_gateway import BoardruleAiConfig, boardrule_ai_runtime, get_slots

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


def _sse_bytes(payload: dict[str, Any]) -> bytes:
    """One SSE event: ``data: <JSON>\\n\\n`` (see ``chat-sse-protocol.ts``)."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


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


def _chat_stream_impl(body: ChatRequest) -> Iterator[bytes]:
    """Core generator: phases + token deltas + sources + done / error."""
    logger.info(
        "chat stream start game_id=%s prior_turns=%d message_chars=%d",
        body.game_id,
        len(body.messages),
        len(body.message),
    )
    t0 = time.perf_counter()
    try:
        yield _sse_bytes({"type": "phase", "id": "prepare"})
        query_engine = build_rulebook_query_engine(body.game_id, streaming=True)
    except FileNotFoundError as e:
        yield _sse_bytes({"type": "error", "message": str(e)})
        return
    except RuntimeError as e:
        yield _sse_bytes({"type": "error", "message": str(e)})
        return

    llm = get_chat_llm()

    try:
        if body.messages:
            yield _sse_bytes({"type": "phase", "id": "clarify"})
            history: list[ChatMessage] = []
            for m in body.messages:
                role = MessageRole.USER if m.role == "user" else MessageRole.ASSISTANT
                history.append(ChatMessage(role=role, content=m.content))
            chat_engine = CondenseQuestionChatEngine.from_defaults(
                query_engine=query_engine,
                chat_history=history,
                llm=llm,
                condense_question_prompt=_RULEBOOK_CONDENSE_PROMPT,
            )
            condensed_question = chat_engine._condense_question(
                chat_engine.chat_history,
                body.message,
            )
        else:
            condensed_question = body.message

        yield _sse_bytes({"type": "phase", "id": "search"})
        nodes = query_engine.retrieve(QueryBundle(condensed_question))
        yield _sse_bytes({"type": "phase", "id": "organize"})
        yield _sse_bytes({"type": "phase", "id": "answer"})

        synth = query_engine.synthesize(QueryBundle(condensed_question), nodes)
        if not isinstance(synth, LlamaStreamingResponse) or synth.response_gen is None:
            yield _sse_bytes(
                {
                    "type": "error",
                    "message": "Streaming synthesis unavailable for this model configuration",
                },
            )
            return

        for chunk in synth.response_gen:
            piece = chunk if isinstance(chunk, str) else str(chunk)
            if piece:
                yield _sse_bytes({"type": "delta", "text": piece})

        refs = _serialize_sources(nodes)
        yield _sse_bytes(
            {
                "type": "sources",
                "sources": [r.model_dump() for r in refs],
            },
        )
        yield _sse_bytes({"type": "done"})
        total_ms = (time.perf_counter() - t0) * 1000.0
        logger.info(
            "chat stream ok game_id=%s total_ms=%.1f sources=%d",
            body.game_id,
            total_ms,
            len(nodes),
        )
    except Exception:
        logger.exception("chat stream failed game_id=%s", body.game_id)
        yield _sse_bytes({"type": "error", "message": "Chat stream failed"})


@router.post("/chat/stream")
def chat_stream(
    body: ChatRequest,
    _ai: BoardruleAiConfig = Depends(require_boardrule_ai),
) -> StreamingResponse:
    """SSE chat: request body matches ``ChatRequest``; response ``text/event-stream``."""

    def gen() -> Iterator[bytes]:
        with boardrule_ai_runtime(_ai):
            chat_slot = get_slots().chat
            logger.info(
                "chat stream llm provider=%s model=%s index_dir=%s",
                chat_slot.provider,
                chat_slot.model,
                game_index_dir(body.game_id),
            )
            yield from _chat_stream_impl(body)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
