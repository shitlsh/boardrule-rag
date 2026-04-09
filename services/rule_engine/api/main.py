"""FastAPI entrypoint: health, extraction, CORS, LangGraph compile + Postgres checkpoint backend."""

from __future__ import annotations

import contextlib
import logging
import os
from collections.abc import AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.middleware_api_key import RuleEngineApiKeyMiddleware
from api.routers import chat, extract, health
from api.routers import index as index_api
from graphs.extraction_graph import build_extraction_graph
from utils.ai_gateway import BoardruleAiConfig
from utils.paths import page_assets_root

load_dotenv()

_compiled_graph = None


def _configure_boardrule_logging() -> None:
    """Ensure ``boardrule.*`` loggers emit to stderr (uvicorn does not configure them by default)."""
    raw = (os.environ.get("RULE_ENGINE_LOG_LEVEL") or "INFO").strip().upper()
    level = getattr(logging, raw, logging.INFO)
    root = logging.getLogger("boardrule")
    if root.handlers:
        root.setLevel(level)
        return
    root.setLevel(level)
    handler = logging.StreamHandler()
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
    root.addHandler(handler)
    root.propagate = False


def get_compiled_graph():
    global _compiled_graph
    if _compiled_graph is None:
        raise RuntimeError("Application graph is not initialized")
    return _compiled_graph


def _postgres_checkpoint_uri() -> str | None:
    raw = (os.environ.get("RULE_ENGINE_CHECKPOINT_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if raw.startswith("postgresql"):
        return raw
    return None


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global _compiled_graph
    _configure_boardrule_logging()
    page_assets_root().mkdir(parents=True, exist_ok=True)
    pg_uri = _postgres_checkpoint_uri()
    if not pg_uri:
        raise RuntimeError(
            "LangGraph checkpoints require PostgreSQL. Set DATABASE_URL or RULE_ENGINE_CHECKPOINT_URL "
            "to a postgresql:// connection string (e.g. the same DATABASE_URL as apps/web: "
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres from `supabase status`). "
            "Local SQLite checkpoints are no longer supported."
        )
    from langgraph.checkpoint.postgres import PostgresSaver

    with PostgresSaver.from_conn_string(pg_uri) as checkpointer:
        checkpointer.setup()
        _compiled_graph = build_extraction_graph(checkpointer)
        yield
    _compiled_graph = None


def _allowed_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "http://localhost:3000")
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(title="boardrule-rag rule engine", lifespan=lifespan)


logger = logging.getLogger("boardrule.api")


@app.middleware("http")
async def boardrule_ai_header_middleware(request: Request, call_next):
    """Parse ``X-Boardrule-Ai-Config`` onto ``request.state`` for routes that need Gemini."""
    if request.method == "POST":
        if request.url.path == "/chat":
            logger.info("POST /chat received (before handler)")
        elif request.url.path == "/extract":
            logger.info("POST /extract received (before handler; background task runs after response)")
    raw = request.headers.get("x-boardrule-ai-config")
    if raw:
        try:
            request.state.boardrule_ai = BoardruleAiConfig.model_validate_json(raw)
            request.state.boardrule_ai_invalid = False
        except Exception:
            request.state.boardrule_ai = None
            request.state.boardrule_ai_invalid = True
    else:
        request.state.boardrule_ai = None
        request.state.boardrule_ai_invalid = False
    return await call_next(request)


app.add_middleware(RuleEngineApiKeyMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(extract.router)
app.include_router(index_api.router)
app.include_router(chat.router)

app.mount(
    "/page-assets",
    StaticFiles(directory=str(page_assets_root())),
    name="page_assets",
)
