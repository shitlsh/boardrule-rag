"""Async extraction jobs: rasterize pages, POST /extract/pages, POST /extract, GET /extract/{job_id}."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import uuid
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from threading import Lock
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from graphs.extraction_graph import run_extraction
from graphs.state import ExtractionState
from ingestion.page_jobs import get_job, register_job
from ingestion.page_raster import import_ordered_images_to_dir, rasterize_pdf_to_dir
from utils.paths import page_assets_root

router = APIRouter(tags=["extract"])


class JobStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


@dataclass
class ExtractJob:
    status: JobStatus = JobStatus.pending
    error: str | None = None
    result: dict[str, Any] | None = None
    thread_id: str = ""
    game_id: str = ""
    game_name: str = ""
    terminology_context: str = ""
    source_file: str = ""
    parsed_text_cache: str | None = None
    vision_cache: dict[str, Any] | None = None


_jobs: dict[str, ExtractJob] = {}
_jobs_lock = Lock()


class ExtractJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    thread_id: str = ""
    game_id: str = ""


class PageInfo(BaseModel):
    page: int
    url: str


class ExtractPagesResponse(BaseModel):
    job_id: str
    game_id: str
    total_pages: int
    pages: list[PageInfo]


class ExtractPollResponse(BaseModel):
    job_id: str
    status: JobStatus
    game_id: str = ""
    error: str | None = None
    merged_markdown: str | None = None
    structured_chapters: list[dict[str, Any]] = Field(default_factory=list)
    quick_start: str | None = None
    suggested_questions: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    last_checkpoint_id: str | None = None


def _get_graph():
    from api.main import get_compiled_graph

    return get_compiled_graph()


def _parse_index_list(raw: str | None, *, field_name: str) -> list[int]:
    if raw is None or raw == "":
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON for {field_name}: {e}") from e
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail=f"{field_name} must be a JSON array of integers")
    out: list[int] = []
    for x in data:
        if isinstance(x, bool) or not isinstance(x, int):
            raise HTTPException(status_code=400, detail=f"{field_name} must contain integers only")
        out.append(int(x))
    return sorted(set(out))


def _compute_body_page_indices(
    page_rows: list[dict[str, Any]],
    toc_page_indices: list[int],
    exclude_page_indices: list[int],
) -> list[int]:
    all_pages = sorted({int(r["page"]) for r in page_rows if r.get("page") is not None})
    toc = set(toc_page_indices)
    exc = set(exclude_page_indices)
    return [p for p in all_pages if p not in exc and p not in toc]


def _build_page_rows(assets: list[Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for a in assets:
        rows.append({"page": int(a.page), "path": str(a.path)})
    return rows


def _run_sync(job_id: str, initial: ExtractionState) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.status = JobStatus.processing
        thread_id = job.thread_id

    try:
        graph = _get_graph()
        final = run_extraction(graph, initial, thread_id=thread_id)
        out = {
            "merged_markdown": final.get("merged_markdown"),
            "structured_chapters": final.get("structured_chapters") or [],
            "quick_start": final.get("quick_start"),
            "suggested_questions": final.get("suggested_questions") or [],
            "errors": final.get("errors") or [],
            "toc": final.get("toc"),
            "complexity": final.get("complexity"),
            "last_checkpoint_id": thread_id,
        }
        with _jobs_lock:
            j = _jobs.get(job_id)
            if j:
                j.result = out
                j.status = JobStatus.completed
    except Exception as e:  # noqa: BLE001
        with _jobs_lock:
            j = _jobs.get(job_id)
            if j:
                j.status = JobStatus.failed
                j.error = str(e)


def _download_to_temp(url: str) -> Path:
    suffix = Path(url.split("?", maxsplit=1)[0]).suffix or ".pdf"
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    p = Path(path)
    with httpx.Client(timeout=120.0) as client:
        r = client.get(url, follow_redirects=True)
        r.raise_for_status()
        p.write_bytes(r.content)
    return p


def _public_page_url(job_id: str, filename: str) -> str:
    base = os.environ.get("RULE_ENGINE_PUBLIC_URL", "").strip().rstrip("/")
    rel = f"/page-assets/{job_id}/{filename}"
    if base:
        return f"{base}{rel}"
    return rel


@router.post("/extract/pages", response_model=ExtractPagesResponse)
async def prepare_rulebook_pages(
    game_id: str = Form(...),
    file: UploadFile | None = File(None),
    file_url: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
) -> ExtractPagesResponse:
    """
    Rasterize a PDF or register ordered images as page PNGs. Returns a `job_id` for `POST /extract`
    together with TOC / exclude page selections.
    """
    multi = files or []
    if not file and not file_url and len(multi) == 0:
        raise HTTPException(status_code=400, detail="Provide `file`, `file_url`, or multiple `files`")

    jid = str(uuid.uuid4())
    root = page_assets_root()
    root.mkdir(parents=True, exist_ok=True)
    out_dir = root / jid

    tmp_paths: list[Path] = []
    try:
        if len(multi) > 0:
            paths: list[Path] = []
            for uf in multi:
                if not uf.filename:
                    continue
                fd, raw = tempfile.mkstemp(suffix=Path(uf.filename).suffix or ".png")
                os.close(fd)
                pth = Path(raw)
                pth.write_bytes(await uf.read())
                tmp_paths.append(pth)
                paths.append(pth)
            if not paths:
                raise HTTPException(status_code=400, detail="No usable files in `files`")
            assets, meta = await asyncio.to_thread(import_ordered_images_to_dir, paths, out_dir)
            src_name = "image_set"
        else:
            if file_url:
                tmp_path = await asyncio.to_thread(_download_to_temp, file_url)
                tmp_paths.append(tmp_path)
                src_name = file_url
                local = tmp_path
            else:
                assert file is not None
                suffix = Path(file.filename or "rules.pdf").suffix or ".pdf"
                fd, raw = tempfile.mkstemp(suffix=suffix)
                os.close(fd)
                local = Path(raw)
                local.write_bytes(await file.read())
                tmp_paths.append(local)
                src_name = file.filename or str(local)

            suf = local.suffix.lower()
            if suf == ".pdf":
                assets, meta = await asyncio.to_thread(rasterize_pdf_to_dir, local, out_dir)
            else:
                assets, meta = await asyncio.to_thread(import_ordered_images_to_dir, [local], out_dir)

        register_job(jid, src_name, assets, meta)

        pages_out: list[PageInfo] = []
        for a in assets:
            name = a.path.name
            pages_out.append(PageInfo(page=int(a.page), url=_public_page_url(jid, name)))

        return ExtractPagesResponse(
            job_id=jid,
            game_id=game_id,
            total_pages=len(assets),
            pages=pages_out,
        )
    finally:
        for p in tmp_paths:
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass


@router.post("/extract", response_model=ExtractJobResponse)
async def start_extract(
    background_tasks: BackgroundTasks,
    game_id: str = Form(...),
    game_name: str | None = Form(None),
    terminology_context: str | None = Form(None),
    resume: bool = Form(False),
    job_id: str | None = Form(None),
    page_job_id: str | None = Form(None),
    toc_page_indices: str | None = Form(None),
    exclude_page_indices: str | None = Form(None),
) -> ExtractJobResponse:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY is not configured")

    jid = job_id or str(uuid.uuid4())
    thread_id = f"{jid}-run-{uuid.uuid4()}"

    if resume:
        if not job_id:
            raise HTTPException(status_code=400, detail="job_id is required when resume=true")
        with _jobs_lock:
            prev = _jobs.get(jid)
        if not prev or not prev.vision_cache:
            raise HTTPException(status_code=400, detail="Cannot resume: unknown job or missing vision cache")
        gn = game_name if game_name is not None else (prev.game_name or "")
        tc = terminology_context if terminology_context is not None else (prev.terminology_context or "")
        vc = prev.vision_cache
        initial = {
            "game_id": game_id,
            "game_name": gn,
            "terminology_context": tc,
            "source_file": str(vc.get("source_file") or "resumed"),
            "source_url": vc.get("source_url"),
            "parsed_text": "",
            "parsed_metadata": {},
            "page_rows": list(vc.get("page_rows") or []),
            "toc_page_indices": list(vc.get("toc_page_indices") or []),
            "exclude_page_indices": list(vc.get("exclude_page_indices") or []),
            "body_page_indices": list(vc.get("body_page_indices") or []),
            "errors": [],
            "retry_count": 0,
        }
        with _jobs_lock:
            job = _jobs.get(jid)
        if not job:
            raise HTTPException(status_code=404, detail="Extract job not found")
        with _jobs_lock:
            job.status = JobStatus.pending
            job.error = None
            job.result = None
            job.thread_id = thread_id
            job.game_id = game_id
            job.game_name = gn
            job.terminology_context = tc
    else:
        if not page_job_id:
            raise HTTPException(
                status_code=400,
                detail="`page_job_id` is required (call POST /extract/pages first to rasterize the rulebook)",
            )
        pr = get_job(page_job_id)
        if not pr:
            raise HTTPException(status_code=404, detail="Unknown page_job_id; prepare pages again")

        toc = _parse_index_list(toc_page_indices, field_name="toc_page_indices")
        exclude = _parse_index_list(exclude_page_indices, field_name="exclude_page_indices")

        page_rows = _build_page_rows(pr.pages)
        if not page_rows:
            raise HTTPException(status_code=400, detail="Page job has no pages")

        if not toc:
            toc = [page_rows[0]["page"]]
        body = _compute_body_page_indices(page_rows, toc, exclude)
        if not body:
            raise HTTPException(
                status_code=400,
                detail="No body pages after excluding TOC and ads; adjust toc_page_indices / exclude_page_indices",
            )

        gn = game_name or ""
        tc = terminology_context if terminology_context is not None else ""
        source_name = pr.source_name
        initial = {
            "game_id": game_id,
            "game_name": gn,
            "terminology_context": tc,
            "source_file": source_name,
            "source_url": None,
            "parsed_text": "",
            "parsed_metadata": pr.meta or {},
            "page_rows": page_rows,
            "toc_page_indices": toc,
            "exclude_page_indices": exclude,
            "body_page_indices": body,
            "errors": [],
            "retry_count": 0,
        }
        vision_cache = {
            "page_rows": page_rows,
            "toc_page_indices": toc,
            "exclude_page_indices": exclude,
            "body_page_indices": body,
            "source_file": source_name,
            "source_url": None,
        }
        with _jobs_lock:
            _jobs[jid] = ExtractJob(
                status=JobStatus.pending,
                thread_id=thread_id,
                game_id=game_id,
                game_name=gn,
                terminology_context=tc,
                source_file=source_name,
                parsed_text_cache="",
                vision_cache=vision_cache,
            )

    background_tasks.add_task(_run_sync, jid, initial)

    with _jobs_lock:
        j = _jobs.setdefault(jid, ExtractJob(thread_id=thread_id, game_id=game_id))
        j.thread_id = thread_id
        j.game_id = game_id

    return ExtractJobResponse(job_id=jid, status=JobStatus.pending, thread_id=thread_id, game_id=game_id)


@router.get("/extract/{job_id}", response_model=ExtractPollResponse)
async def get_extract_job(job_id: str) -> ExtractPollResponse:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    res = job.result or {}
    return ExtractPollResponse(
        job_id=job_id,
        status=job.status,
        game_id=job.game_id,
        error=job.error,
        merged_markdown=res.get("merged_markdown"),
        structured_chapters=res.get("structured_chapters") or [],
        quick_start=res.get("quick_start"),
        suggested_questions=res.get("suggested_questions") or [],
        errors=res.get("errors") or [],
        last_checkpoint_id=res.get("last_checkpoint_id"),
    )
