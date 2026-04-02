"""Phase 2: per-game VectorStoreIndex + BM25 + hybrid + rerank."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ingestion.index_builder import build_and_persist_index, load_hybrid_reranked_nodes, load_manifest

router = APIRouter(tags=["index"])


class BuildIndexRequest(BaseModel):
    game_id: str = Field(..., min_length=1)
    merged_markdown: str = Field(..., min_length=1)
    source_file: str | None = None


class BuildIndexResponse(BaseModel):
    status: str
    game_id: str
    index_id: str
    manifest: dict[str, Any]


class IndexManifestResponse(BaseModel):
    game_id: str
    manifest: dict[str, Any] | None


@router.post("/build-index", response_model=BuildIndexResponse)
async def build_index(body: BuildIndexRequest) -> BuildIndexResponse:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY is not configured")
    try:
        manifest = build_and_persist_index(
            game_id=body.game_id,
            merged_markdown=body.merged_markdown,
            source_file=body.source_file or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    gid = manifest.get("game_id", body.game_id)
    return BuildIndexResponse(
        status="completed",
        game_id=gid,
        index_id=gid,
        manifest=manifest,
    )


@router.get("/index/{game_id}/manifest", response_model=IndexManifestResponse)
async def get_index_manifest(game_id: str) -> IndexManifestResponse:
    m = load_manifest(game_id)
    return IndexManifestResponse(game_id=game_id, manifest=m)


@router.get("/index/{game_id}/smoke-retrieve")
async def smoke_retrieve(game_id: str, q: str = "规则") -> dict[str, Any]:
    """Dev-only sanity check: hybrid + rerank without LLM synthesis (NO_TEXT)."""
    if not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY is not configured")
    try:
        nodes = load_hybrid_reranked_nodes(game_id, q)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    sources: list[dict[str, Any]] = []
    for sn in nodes:
        meta = getattr(sn.node, "metadata", {}) or {}
        sources.append(
            {
                "score": getattr(sn, "score", None),
                "text_preview": (sn.node.get_content() or "")[:400],
                "metadata": {
                    "game_id": meta.get("game_id"),
                    "source_file": meta.get("source_file"),
                    "pages": meta.get("pages"),
                    "original_page_range": meta.get("original_page_range"),
                    "page_start": meta.get("page_start"),
                    "page_end": meta.get("page_end"),
                },
            }
        )
    return {"query": q, "source_nodes": sources}
