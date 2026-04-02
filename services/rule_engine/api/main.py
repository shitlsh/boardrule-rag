"""FastAPI entrypoint: health, extraction, CORS, LangGraph compile + checkpoint backend."""

from __future__ import annotations

import contextlib
import os
from collections.abc import AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from langgraph.checkpoint.sqlite import SqliteSaver

from api.routers import chat, extract, health
from api.routers import index as index_api
from graphs.extraction_graph import build_extraction_graph
from utils.paths import page_assets_root, service_root

load_dotenv()

_compiled_graph = None


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
    page_assets_root().mkdir(parents=True, exist_ok=True)
    pg_uri = _postgres_checkpoint_uri()
    if pg_uri:
        from langgraph.checkpoint.postgres import PostgresSaver

        with PostgresSaver.from_conn_string(pg_uri) as checkpointer:
            checkpointer.setup()
            _compiled_graph = build_extraction_graph(checkpointer)
            yield
    else:
        db_path = os.environ.get("CHECKPOINT_DB_PATH", str(service_root() / "checkpoints.sqlite"))
        with SqliteSaver.from_conn_string(db_path) as checkpointer:
            checkpointer.setup()
            _compiled_graph = build_extraction_graph(checkpointer)
            yield
    _compiled_graph = None


def _allowed_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "http://localhost:3000")
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(title="boardrule-rag rule engine", lifespan=lifespan)
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
