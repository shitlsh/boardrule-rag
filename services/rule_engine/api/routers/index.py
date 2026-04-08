"""Phase 2: per-game VectorStoreIndex + BM25 + hybrid + rerank."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from llama_index.core import Document
from pydantic import BaseModel, Field, model_validator

from api.deps import require_boardrule_ai
from api.routers import index_jobs
from ingestion.index_builder import build_and_persist_index, load_hybrid_reranked_nodes, load_manifest
from utils.ai_gateway import BoardruleAiConfig, boardrule_ai_runtime

router = APIRouter(tags=["index"])


class DocumentIn(BaseModel):
    text: str = Field(..., min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BuildIndexRequest(BaseModel):
    game_id: str = Field(..., min_length=1)
    merged_markdown: str | None = None
    documents: list[DocumentIn] | None = None
    source_file: str | None = None

    @model_validator(mode="after")
    def _md_or_docs(self) -> "BuildIndexRequest":
        has_md = bool((self.merged_markdown or "").strip())
        has_docs = bool(self.documents)
        if not has_md and not has_docs:
            raise ValueError("Provide merged_markdown or documents")
        return self


class IndexManifestResponse(BaseModel):
    game_id: str
    manifest: dict[str, Any] | None


class BuildIndexStartResponse(BaseModel):
    job_id: str
    status: Literal["pending"] = "pending"


class BuildIndexJobPollResponse(BaseModel):
    job_id: str
    status: Literal["pending", "processing", "completed", "failed"]
    manifest: dict[str, Any] | None = None
    error: str | None = None


def _run_build_index_job(job_id: str, body: BuildIndexRequest, ai_snapshot: dict[str, Any]) -> None:
    index_jobs.set_processing(job_id)
    try:
        with boardrule_ai_runtime(ai_snapshot):
            docs = (
                [Document(text=d.text, metadata=d.metadata) for d in body.documents]
                if body.documents
                else None
            )
            manifest = build_and_persist_index(
                game_id=body.game_id,
                merged_markdown=body.merged_markdown,
                documents=docs,
                source_file=body.source_file or "",
            )
        index_jobs.set_completed(job_id, manifest)
    except Exception as e:  # noqa: BLE001
        index_jobs.set_failed(job_id, str(e))


@router.post("/build-index/start", response_model=BuildIndexStartResponse)
async def start_build_index(
    body: BuildIndexRequest,
    background_tasks: BackgroundTasks,
    _ai: BoardruleAiConfig = Depends(require_boardrule_ai),
) -> BuildIndexStartResponse:
    """Queue index build; poll ``GET /build-index/jobs/{job_id}`` until completed or failed."""
    job_id = index_jobs.create_job()
    snapshot = _ai.model_dump(mode="json", by_alias=True)
    background_tasks.add_task(_run_build_index_job, job_id, body, snapshot)
    return BuildIndexStartResponse(job_id=job_id, status="pending")


@router.get("/build-index/jobs/{job_id}", response_model=BuildIndexJobPollResponse)
async def get_build_index_job(job_id: str) -> BuildIndexJobPollResponse:
    job = index_jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown build-index job_id")
    return BuildIndexJobPollResponse(
        job_id=job_id,
        status=job.status,
        manifest=job.manifest,
        error=job.error,
    )


@router.get("/index/{game_id}/manifest", response_model=IndexManifestResponse)
async def get_index_manifest(game_id: str) -> IndexManifestResponse:
    m = load_manifest(game_id)
    return IndexManifestResponse(game_id=game_id, manifest=m)


@router.get("/index/{game_id}/smoke-retrieve")
async def smoke_retrieve(
    game_id: str,
    q: str = "规则",
    _ai: BoardruleAiConfig = Depends(require_boardrule_ai),
) -> dict[str, Any]:
    """Dev-only sanity check: hybrid + rerank without LLM synthesis (NO_TEXT)."""
    try:
        with boardrule_ai_runtime(_ai):
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
