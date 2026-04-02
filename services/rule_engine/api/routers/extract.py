"""Async extraction jobs: POST /extract, GET /extract/{job_id}."""

from __future__ import annotations

import asyncio
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
from ingestion.llamaparse_loader import parse_file_to_markdown_sync

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


_jobs: dict[str, ExtractJob] = {}
_jobs_lock = Lock()


class ExtractJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    thread_id: str = ""
    game_id: str = ""


class ExtractPollResponse(BaseModel):
    job_id: str
    status: JobStatus
    game_id: str = ""
    error: str | None = None
    merged_markdown: str | None = None
    quick_start: str | None = None
    suggested_questions: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    last_checkpoint_id: str | None = None


def _get_graph():
    from api.main import get_compiled_graph

    return get_compiled_graph()


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


@router.post("/extract", response_model=ExtractJobResponse)
async def start_extract(
    background_tasks: BackgroundTasks,
    game_id: str = Form(...),
    game_name: str | None = Form(None),
    terminology_context: str | None = Form(None),
    resume: bool = Form(False),
    job_id: str | None = Form(None),
    file: UploadFile | None = File(None),
    file_url: str | None = Form(None),
) -> ExtractJobResponse:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise HTTPException(status_code=503, detail="GOOGLE_API_KEY is not configured")
    if not os.environ.get("LLAMA_CLOUD_API_KEY"):
        raise HTTPException(status_code=503, detail="LLAMA_CLOUD_API_KEY is not configured")

    jid = job_id or str(uuid.uuid4())
    # LangGraph checkpointer thread: fresh id per run so retries do not merge with stale checkpoints.
    thread_id = f"{jid}-run-{uuid.uuid4()}"

    if resume:
        with _jobs_lock:
            prev = _jobs.get(jid)
        if not prev or not prev.parsed_text_cache:
            raise HTTPException(status_code=400, detail="Cannot resume: unknown job or missing cached parse")
        gn = game_name if game_name is not None else (prev.game_name or "")
        tc = terminology_context if terminology_context is not None else (prev.terminology_context or "")
        initial: ExtractionState = {
            "game_id": game_id,
            "game_name": gn,
            "terminology_context": tc,
            "source_file": prev.source_file or "resumed",
            "parsed_text": prev.parsed_text_cache,
            "parsed_metadata": {},
            "errors": [],
            "retry_count": 0,
        }
        with _jobs_lock:
            job = _jobs[jid]
            job.status = JobStatus.pending
            job.error = None
            job.result = None
            job.thread_id = thread_id
            job.game_id = game_id
            job.game_name = gn
            job.terminology_context = tc
    else:
        if not file and not file_url:
            raise HTTPException(status_code=400, detail="Provide either `file` or `file_url`")

        tmp_path: Path | None = None
        source_name = ""
        try:
            if file_url:
                tmp_path = await asyncio.to_thread(_download_to_temp, file_url)
                source_name = file_url
            else:
                assert file is not None
                suffix = Path(file.filename or "rules.pdf").suffix or ".pdf"
                fd, raw = tempfile.mkstemp(suffix=suffix)
                os.close(fd)
                tmp_path = Path(raw)
                content = await file.read()
                tmp_path.write_bytes(content)
                source_name = file.filename or str(tmp_path)

            def _parse() -> tuple[str, dict[str, Any]]:
                assert tmp_path is not None
                return parse_file_to_markdown_sync(tmp_path)

            parsed_text, meta = await asyncio.to_thread(_parse)
        finally:
            if tmp_path and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

        gn = game_name or ""
        tc = terminology_context if terminology_context is not None else ""
        initial = {
            "game_id": game_id,
            "game_name": gn,
            "terminology_context": tc,
            "source_file": source_name,
            "source_url": file_url,
            "parsed_text": parsed_text,
            "parsed_metadata": meta,
            "errors": [],
            "retry_count": 0,
        }
        with _jobs_lock:
            _jobs[jid] = ExtractJob(
                status=JobStatus.pending,
                thread_id=thread_id,
                game_id=game_id,
                game_name=gn,
                terminology_context=tc,
                source_file=source_name,
                parsed_text_cache=parsed_text,
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
        quick_start=res.get("quick_start"),
        suggested_questions=res.get("suggested_questions") or [],
        errors=res.get("errors") or [],
        last_checkpoint_id=res.get("last_checkpoint_id"),
    )
