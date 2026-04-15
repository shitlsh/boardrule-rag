"""Phase 3: RAG chat over per-game index (LlamaIndex QueryEngine + optional multi-turn condense).

SSE streaming: ``POST /chat/stream`` emits JSON lines documented in ``apps/web/lib/chat-sse-protocol.ts``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
import time
from collections.abc import AsyncIterator, Iterator
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
from utils.ai_gateway import (
    BoardruleAiConfig,
    boardrule_ai_runtime,
    get_chat_rag_options,
    get_slots,
)

router = APIRouter(tags=["chat"])

logger = logging.getLogger("boardrule.chat")

# Replaces LlamaIndex default English condense template ("Given a conversation...").
# 仅时间/顺序指代子串（不含「这/那/他」等代词），用于保守地禁止跳过 condense。
_CONDENSE_TEMPORAL_ORDER_SUBSTRINGS_CN: tuple[str, ...] = (
    "刚才",
    "之前",
    "前面",
    "上面",
    "下面",
    "下一",
    "上一",
    "继续",
    "再",
)


def _message_has_temporal_order_trigger(message: str) -> bool:
    s = message.strip()
    return any(needle in s for needle in _CONDENSE_TEMPORAL_ORDER_SUBSTRINGS_CN)


def _truncate_prior_messages(msgs: list[ChatMessageIn], max_turns: int) -> list[ChatMessageIn]:
    """Keep at most ``max_turns`` full user+assistant rounds from the end of ``msgs``."""
    max_msgs = max_turns * 2
    if not msgs or max_msgs < 1:
        return list(msgs)
    if len(msgs) <= max_msgs:
        return list(msgs)
    tail = msgs[-max_msgs:]
    i = 0
    while i < len(tail) and tail[i].role == "assistant":
        i += 1
    return tail[i:]


def _should_skip_condense_heuristic(
    current_message: str,
    prior_after_trunc: list[ChatMessageIn],
    min_chars: int,
) -> bool:
    """Fast path: long standalone question with no temporal/order cue and non-empty prior history."""
    if not prior_after_trunc:
        return False
    s = current_message.strip()
    if len(s) <= min_chars:
        return False
    if _message_has_temporal_order_trigger(current_message):
        return False
    return True


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
    max_prior_turns, skip_min_chars = get_chat_rag_options()
    prior_msgs_in = len(body.messages)
    prior_truncated = _truncate_prior_messages(body.messages, max_prior_turns)
    after_trunc = len(prior_truncated)
    logger.info(
        "chat stream start game_id=%s prior_msgs_in=%d prior_after_trunc=%d max_prior_turns=%d "
        "skip_condense_min_chars=%d message_chars=%d",
        body.game_id,
        prior_msgs_in,
        after_trunc,
        max_prior_turns,
        skip_min_chars,
        len(body.message),
    )
    t0 = time.perf_counter()
    t_build_begin = t0  # initialised here so except clauses can always reference it
    try:
        yield _sse_bytes({"type": "phase", "id": "prepare"})
        t_build_begin = time.perf_counter()
        query_engine = build_rulebook_query_engine(body.game_id, streaming=True)
        setup_ms = (time.perf_counter() - t_build_begin) * 1000.0
    except FileNotFoundError as e:
        setup_ms = (time.perf_counter() - t_build_begin) * 1000.0
        logger.warning(
            "chat stream setup failed game_id=%s setup_ms=%.1f err=%s",
            body.game_id,
            setup_ms,
            e,
        )
        yield _sse_bytes({"type": "error", "message": str(e)})
        return
    except RuntimeError as e:
        setup_ms = (time.perf_counter() - t_build_begin) * 1000.0
        logger.warning(
            "chat stream setup failed game_id=%s setup_ms=%.1f err=%s",
            body.game_id,
            setup_ms,
            e,
        )
        yield _sse_bytes({"type": "error", "message": str(e)})
        return

    llm = get_chat_llm()

    try:
        condense_ms = 0.0
        condensed_question = body.message
        condense_skipped = False
        if prior_truncated:
            yield _sse_bytes({"type": "phase", "id": "clarify"})
            t_condense_begin = time.perf_counter()
            if _should_skip_condense_heuristic(body.message, prior_truncated, skip_min_chars):
                condensed_question = body.message
                condense_ms = 0.0
                condense_skipped = True
                logger.info(
                    "chat condense skipped (heuristic) game_id=%s prior_msgs_in=%d prior_after_trunc=%d "
                    "max_prior_turns=%d skip_condense_min_chars=%d",
                    body.game_id,
                    prior_msgs_in,
                    after_trunc,
                    max_prior_turns,
                    skip_min_chars,
                )
            else:
                history: list[ChatMessage] = []
                for m in prior_truncated:
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
                condense_ms = (time.perf_counter() - t_condense_begin) * 1000.0

        yield _sse_bytes({"type": "phase", "id": "search"})
        t_retrieve_begin = time.perf_counter()
        nodes = query_engine.retrieve(QueryBundle(condensed_question))
        retrieve_ms = (time.perf_counter() - t_retrieve_begin) * 1000.0

        yield _sse_bytes({"type": "phase", "id": "organize"})
        yield _sse_bytes({"type": "phase", "id": "answer"})

        t_synth_begin = time.perf_counter()
        synth = query_engine.synthesize(QueryBundle(condensed_question), nodes)
        synth_prep_ms = (time.perf_counter() - t_synth_begin) * 1000.0
        if not isinstance(synth, LlamaStreamingResponse) or synth.response_gen is None:
            total_ms = (time.perf_counter() - t0) * 1000.0
            logger.warning(
                "chat stream no streaming synthesis game_id=%s total_ms=%.1f "
                "setup_ms=%.1f condense_ms=%.1f retrieve_ms=%.1f synth_prep_ms=%.1f "
                "condense_skipped=%s prior_msgs_in=%d prior_after_trunc=%d",
                body.game_id,
                total_ms,
                setup_ms,
                condense_ms,
                retrieve_ms,
                synth_prep_ms,
                condense_skipped,
                prior_msgs_in,
                after_trunc,
            )
            yield _sse_bytes(
                {
                    "type": "error",
                    "message": "Streaming synthesis unavailable for this model configuration",
                },
            )
            return

        t_stream_begin = time.perf_counter()
        delta_chunks = 0
        delta_chars = 0
        for chunk in synth.response_gen:
            piece = chunk if isinstance(chunk, str) else str(chunk)
            if piece:
                delta_chunks += 1
                delta_chars += len(piece)
                yield _sse_bytes({"type": "delta", "text": piece})
        stream_ms = (time.perf_counter() - t_stream_begin) * 1000.0

        t_post_begin = time.perf_counter()
        refs = _serialize_sources(nodes)
        yield _sse_bytes(
            {
                "type": "sources",
                "sources": [r.model_dump() for r in refs],
            },
        )
        yield _sse_bytes({"type": "done"})
        post_ms = (time.perf_counter() - t_post_begin) * 1000.0

        total_ms = (time.perf_counter() - t0) * 1000.0
        logger.info(
            "chat stream ok game_id=%s total_ms=%.1f setup_ms=%.1f condense_ms=%.1f "
            "retrieve_ms=%.1f synth_prep_ms=%.1f stream_ms=%.1f post_ms=%.1f "
            "sources=%d delta_chunks=%d delta_chars=%d condense_skipped=%s "
            "prior_msgs_in=%d prior_after_trunc=%d max_prior_turns=%d skip_condense_min_chars=%d",
            body.game_id,
            total_ms,
            setup_ms,
            condense_ms,
            retrieve_ms,
            synth_prep_ms,
            stream_ms,
            post_ms,
            len(nodes),
            delta_chunks,
            delta_chars,
            condense_skipped,
            prior_msgs_in,
            after_trunc,
            max_prior_turns,
            skip_min_chars,
        )
    except Exception:
        total_ms = (time.perf_counter() - t0) * 1000.0
        logger.exception(
            "chat stream failed game_id=%s total_ms=%.1f (partial timings may omit later stages)",
            body.game_id,
            total_ms,
        )
        yield _sse_bytes({"type": "error", "message": "Chat stream failed"})


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    _ai: BoardruleAiConfig = Depends(require_boardrule_ai),
) -> StreamingResponse:
    """SSE chat: request body matches ``ChatRequest``; response ``text/event-stream``.

    Starlette wraps **sync** iterators in ``iterate_in_threadpool``, which can run each
    ``next()`` on a **different** worker thread. ``boardrule_ai_runtime`` uses a
    ``contextvars.Token`` that must be reset on the **same** thread that called ``set``,
    so we run the entire sync generator in **one** dedicated thread and bridge chunks with
    a **stdlib** ``queue.Queue`` bridged with ``asyncio.to_thread(q.get)`` — avoids
    ``run_coroutine_threadsafe(...).result()`` failing to deliver the end sentinel, which
    would leave the async generator stuck on ``await q.get()`` and never close the HTTP
    body (browser: fetch never completes; UI stays in sending state).
    """

    async def agen() -> AsyncIterator[bytes]:
        sq: queue.Queue[bytes | None] = queue.Queue()
        sync_err: list[BaseException] = []
        chunks_sent = 0

        def worker() -> None:
            try:
                with boardrule_ai_runtime(_ai):
                    chat_slot = get_slots().chat
                    logger.info(
                        "chat stream llm provider=%s model=%s index_dir=%s",
                        chat_slot.provider,
                        chat_slot.model,
                        game_index_dir(body.game_id),
                    )
                    for chunk in _chat_stream_impl(body):
                        sq.put(chunk)
            except BaseException as e:
                sync_err.append(e)
            finally:
                sq.put(None)

        t = threading.Thread(target=worker, daemon=True)
        t.start()
        try:
            while True:
                item = await asyncio.to_thread(sq.get)
                if item is None:
                    break
                chunks_sent += 1
                yield item
            if sync_err:
                if chunks_sent == 0:
                    raise sync_err[0]
                # Not inside an except-handler: logger.exception() would log no traceback.
                logger.error(
                    "chat stream worker failed after %d chunk(s); response may be incomplete",
                    chunks_sent,
                    exc_info=sync_err[0],
                )
        finally:
            t.join(timeout=600)

    return StreamingResponse(
        agen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
