"""Async extraction jobs: rasterize pages, POST /extract/pages, POST /extract, GET /games/{game_id}/extract/{job_id}."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
import uuid
from functools import partial
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from threading import Lock
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from api.deps import require_boardrule_ai
from graphs.extraction_graph import run_extraction
from graphs.state import ExtractionState
from ingestion.page_jobs import get_job, register_job
from ingestion.page_raster import import_ordered_images_to_dir, rasterize_pdf_to_dir
from utils.ai_gateway import BoardruleAiConfig, boardrule_ai_runtime
from utils.exception_format import format_exception_for_job
from utils.paths import game_dir, game_extract_json, game_page_job_json

router = APIRouter(tags=["extract"])

logger = logging.getLogger("boardrule.extract")


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
    ai_snapshot: dict[str, Any] | None = None


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
    complexity: str | None = None
    extraction_profile: str | None = None
    toc: dict[str, Any] | None = None


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


def _all_body_pages_excluding_only_ads(
    page_rows: list[dict[str, Any]],
    exclude_page_indices: list[int],
) -> list[int]:
    exc = set(exclude_page_indices)
    return sorted({int(r["page"]) for r in page_rows if r.get("page") is not None and int(r["page"]) not in exc})


def _validate_rasterized_pages(
    page_rows: list[dict[str, Any]],
    toc_page_indices: list[int],
    body_page_indices: list[int],
) -> None:
    """Require every TOC and body page to have a non-empty image path (vision-only pipeline)."""
    by_page: dict[int, str] = {}
    for r in page_rows:
        p = r.get("page")
        if p is None:
            continue
        path = r.get("path")
        by_page[int(p)] = str(path).strip() if path else ""

    missing_toc = [p for p in sorted(set(toc_page_indices)) if not by_page.get(p)]
    missing_body = [p for p in sorted(set(body_page_indices)) if not by_page.get(p)]
    if missing_toc or missing_body:
        parts: list[str] = []
        if missing_toc:
            parts.append(
                f"TOC pages must have rasterized images (missing path for pages: {missing_toc})",
            )
        if missing_body:
            parts.append(
                f"Body pages must have rasterized images (missing path for pages: {missing_body})",
            )
        raise HTTPException(status_code=400, detail="; ".join(parts))


def _build_page_rows(assets: list[Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for a in assets:
        rows.append({"page": int(a.page), "path": str(a.path)})
    return rows


# ---------------------------------------------------------------------------
# Disk persistence helpers
# ---------------------------------------------------------------------------

def _write_extract_json(
    job_id: str,
    game_id: str,
    status: str,
    thread_id: str,
    error: str | None,
    result: dict[str, Any] | None,
    vision_cache: dict[str, Any] | None,
    ai_snapshot: dict[str, Any] | None,
) -> None:
    """Persist extract-job state to ``{game_dir}/extract.json`` (survives process restarts)."""
    try:
        path = game_extract_json(game_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {
            "job_id": job_id,
            "game_id": game_id,
            "status": status,
            "thread_id": thread_id,
            "error": error,
            "result": result,
            "vision_cache": vision_cache,
            "ai_snapshot": ai_snapshot,
        }
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception:  # noqa: BLE001
        logger.warning("extract job %s: failed to write extract.json (non-fatal)", job_id, exc_info=True)


def _read_extract_json(game_id: str) -> dict[str, Any] | None:
    """Load persisted extract-job state from disk; returns None if absent or corrupt."""
    try:
        path = game_extract_json(game_id)
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        logger.warning("extract: failed to read extract.json for game_id=%s (non-fatal)", game_id, exc_info=True)
        return None


def _poll_response_from_disk(job_id: str, game_id: str) -> ExtractPollResponse | None:
    """Try to build a poll response from on-disk extract.json; returns None on miss/mismatch."""
    disk = _read_extract_json(game_id)
    if not disk or disk.get("job_id") != job_id:
        return None
    res = disk.get("result") or {}
    raw_status = disk.get("status", JobStatus.failed)
    # Jobs that were in-flight when the process died are surfaced as failed.
    if raw_status in (JobStatus.pending, JobStatus.processing, "pending", "processing"):
        raw_status = JobStatus.failed
        disk_error = "进程重启导致任务中断，请重新提交。"
    else:
        disk_error = disk.get("error")
    return ExtractPollResponse(
        job_id=job_id,
        status=raw_status,
        game_id=game_id,
        error=disk_error,
        merged_markdown=res.get("merged_markdown"),
        structured_chapters=res.get("structured_chapters") or [],
        quick_start=res.get("quick_start"),
        suggested_questions=res.get("suggested_questions") or [],
        errors=res.get("errors") or [],
        last_checkpoint_id=res.get("last_checkpoint_id"),
        complexity=res.get("complexity"),
        extraction_profile=res.get("extraction_profile"),
        toc=res.get("toc"),
    )


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

def _run_sync(job_id: str, initial: ExtractionState, ai_snapshot: dict[str, Any]) -> None:
    logger.info("extract job %s: background worker started", job_id)
    with boardrule_ai_runtime(ai_snapshot):
        with _jobs_lock:
            job = _jobs.get(job_id)
            if not job:
                logger.warning("extract job %s: missing job record, worker exit", job_id)
                return
            job.status = JobStatus.processing
            thread_id = job.thread_id

        try:
            graph = _get_graph()
            logger.info("extract job %s: invoking LangGraph (thread_id=%s)", job_id, thread_id)
            final = run_extraction(graph, initial, thread_id=thread_id)
            logger.info("extract job %s: LangGraph finished", job_id)
            out = {
                "merged_markdown": final.get("merged_markdown"),
                "structured_chapters": final.get("structured_chapters") or [],
                "quick_start": final.get("quick_start"),
                "suggested_questions": final.get("suggested_questions") or [],
                "errors": final.get("errors") or [],
                "toc": final.get("toc"),
                "complexity": final.get("complexity"),
                "extraction_profile": final.get("extraction_profile"),
                "last_checkpoint_id": thread_id,
            }
            with _jobs_lock:
                j = _jobs.get(job_id)
                if j:
                    j.result = out
                    j.status = JobStatus.completed
            _write_extract_json(job_id, initial.get("game_id", ""), JobStatus.completed, thread_id, None, out, None, None)
        except Exception as e:  # noqa: BLE001
            logger.exception("extract job %s: failed", job_id)
            err_str = format_exception_for_job(e)
            with _jobs_lock:
                j = _jobs.get(job_id)
                if j:
                    j.status = JobStatus.failed
                    j.error = err_str
            _write_extract_json(job_id, initial.get("game_id", ""), JobStatus.failed, thread_id, err_str, None, None, None)


# ---------------------------------------------------------------------------
# Misc helpers
# ---------------------------------------------------------------------------

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


def _parse_int_form(
    raw: str | None,
    *,
    env_key: str,
    default: int,
    field: str,
) -> int:
    if raw is None or str(raw).strip() == "":
        ev = os.environ.get(env_key, "").strip()
        return int(ev) if ev.isdigit() else default
    try:
        n = int(str(raw).strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"{field} 必须是整数") from e
    if n < 1:
        raise HTTPException(status_code=400, detail=f"{field} 必须 ≥ 1")
    return n


def _parse_optional_bool_form(raw: str | None) -> bool:
    if raw is None:
        return False
    s = str(raw).strip().lower()
    return s in ("1", "true", "yes", "on")


def _parse_max_side_form(raw: str | None) -> int | None:
    if raw is None or str(raw).strip() == "":
        ev = os.environ.get("PAGE_RASTER_MAX_SIDE", "2048").strip()
        if ev == "" or ev.lower() in ("0", "none", "off"):
            return None
        return int(ev) if ev.isdigit() else 2048
    try:
        n = int(str(raw).strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="page_raster_max_side 必须是整数") from e
    if n <= 0:
        return None
    return n


def _public_page_url(game_id: str, filename: str) -> str:
    """Public URL for a rasterized page image: ``/page-assets/{game_id}/{filename}``."""
    base = os.environ.get("RULE_ENGINE_PUBLIC_URL", "").strip().rstrip("/")
    rel = f"/page-assets/{game_id}/{filename}"
    if base:
        return f"{base}{rel}"
    return rel


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/extract/pages", response_model=ExtractPagesResponse)
async def prepare_rulebook_pages(
    game_id: str = Form(...),
    file: UploadFile | None = File(None),
    file_url: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    page_raster_dpi: str | None = Form(None),
    page_raster_max_side: str | None = Form(None),
    max_pages: str | None = Form(None),
    max_multi_image_files: str | None = Form(None),
    max_pdf_bytes: str | None = Form(None),
    max_image_bytes: str | None = Form(None),
) -> ExtractPagesResponse:
    """
    Rasterize a PDF or register ordered images as page PNGs. Returns a ``page_job_id`` for
    ``POST /extract`` together with TOC / exclude page selections.

    Images are stored flat in ``{PAGE_ASSETS_ROOT}/{game_id}/``.  Any existing images from a
    previous upload for the same game are deleted first to reclaim disk space (1 set per game).
    """
    multi = files or []
    if not file and not file_url and len(multi) == 0:
        raise HTTPException(status_code=400, detail="Provide `file`, `file_url`, or multiple `files`")

    dpi_val = _parse_int_form(page_raster_dpi, env_key="PAGE_RASTER_DPI", default=150, field="page_raster_dpi")
    max_side_val = _parse_max_side_form(page_raster_max_side)
    max_pages_val = _parse_int_form(max_pages, env_key="RULEBOOK_MAX_PAGES", default=80, field="max_pages")
    max_multi_val = _parse_int_form(max_multi_image_files, env_key="RULEBOOK_MAX_MULTI_IMAGE_FILES", default=60, field="max_multi_image_files")
    max_pdf_b = _parse_int_form(max_pdf_bytes, env_key="RULEBOOK_MAX_PDF_BYTES", default=52428800, field="max_pdf_bytes")
    max_img_b = _parse_int_form(max_image_bytes, env_key="RULEBOOK_MAX_IMAGE_BYTES", default=10485760, field="max_image_bytes")

    jid = str(uuid.uuid4())
    gdir = game_dir(game_id)
    gdir.mkdir(parents=True, exist_ok=True)

    # Delete old PNGs (and page_job.json) from previous uploads for this game.
    # extract.json is kept — its result remains readable after a new upload.
    _KEEP = {"extract.json"}
    for old in gdir.iterdir():
        if old.name not in _KEEP:
            if old.is_dir():
                shutil.rmtree(old, ignore_errors=True)
            else:
                try:
                    old.unlink()
                except OSError:
                    pass
            logger.info("prepare_pages: removed old asset %s for game_id=%s", old.name, game_id)

    out_dir = gdir  # images land directly in the game directory

    tmp_paths: list[Path] = []
    try:
        if len(multi) > 0:
            nonempty = [uf for uf in multi if uf.filename]
            if len(nonempty) > max_multi_val:
                raise HTTPException(
                    status_code=400,
                    detail=f"一次最多上传 {max_multi_val} 张图片，当前 {len(nonempty)} 张",
                )
            paths: list[Path] = []
            for uf in nonempty:
                raw_bytes = await uf.read()
                if len(raw_bytes) > max_img_b:
                    raise HTTPException(
                        status_code=400,
                        detail=f"图片 {uf.filename} 超过单张上限 {max_img_b} 字节",
                    )
                fd, raw_path = tempfile.mkstemp(suffix=Path(uf.filename).suffix or ".png")
                os.close(fd)
                pth = Path(raw_path)
                pth.write_bytes(raw_bytes)
                tmp_paths.append(pth)
                paths.append(pth)
            if not paths:
                raise HTTPException(status_code=400, detail="No usable files in `files`")
            assets, meta = await asyncio.to_thread(
                partial(import_ordered_images_to_dir, paths, out_dir, max_side=max_side_val),
            )
            src_name = "image_set"
        else:
            if file_url:
                tmp_path = await asyncio.to_thread(_download_to_temp, file_url)
                tmp_paths.append(tmp_path)
                src_name = file_url
                local = tmp_path
            else:
                if file is None:
                    raise RuntimeError("file upload is required when file_url is not provided")
                suffix = Path(file.filename or "rules.pdf").suffix or ".pdf"
                fd, raw = tempfile.mkstemp(suffix=suffix)
                os.close(fd)
                local = Path(raw)
                local.write_bytes(await file.read())
                tmp_paths.append(local)
                src_name = file.filename or str(local)

            suf = local.suffix.lower()
            if suf == ".pdf":
                if local.stat().st_size > max_pdf_b:
                    raise HTTPException(status_code=400, detail=f"PDF 超过单文件上限 {max_pdf_b} 字节")
                assets, meta = await asyncio.to_thread(
                    partial(rasterize_pdf_to_dir, local, out_dir, dpi=dpi_val, max_side=max_side_val),
                )
            else:
                if local.stat().st_size > max_img_b:
                    raise HTTPException(status_code=400, detail=f"图片超过单文件上限 {max_img_b} 字节")
                assets, meta = await asyncio.to_thread(
                    partial(import_ordered_images_to_dir, [local], out_dir, max_side=max_side_val),
                )

        if len(assets) > max_pages_val:
            raise HTTPException(status_code=400, detail=f"分页后共 {len(assets)} 页，超过上限 {max_pages_val} 页")

        register_job(jid, src_name, assets, meta)

        # Persist page-job metadata so the extract resume path survives restarts.
        page_rows_for_disk = [{"page": int(a.page), "path": str(a.path)} for a in assets]
        try:
            pj_path = game_page_job_json(game_id)
            pj_path.write_text(
                json.dumps({"page_job_id": jid, "source_name": src_name, "page_rows": page_rows_for_disk, "meta": meta}, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:  # noqa: BLE001
            logger.warning("prepare_pages: failed to write page_job.json (non-fatal)", exc_info=True)

        pages_out = [PageInfo(page=int(a.page), url=_public_page_url(game_id, a.path.name)) for a in assets]
        return ExtractPagesResponse(job_id=jid, game_id=game_id, total_pages=len(assets), pages=pages_out)
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
    force_full_pipeline: str | None = Form(None),
    _ai: BoardruleAiConfig = Depends(require_boardrule_ai),
) -> ExtractJobResponse:
    snapshot = _ai.model_dump(mode="json", by_alias=True)
    force_full = _parse_optional_bool_form(force_full_pipeline)

    jid = job_id or str(uuid.uuid4())
    thread_id = f"{jid}-run-{uuid.uuid4()}"

    if resume:
        if not job_id:
            raise HTTPException(status_code=400, detail="job_id is required when resume=true")
        with _jobs_lock:
            prev = _jobs.get(jid)

        # Resolve vision_cache: memory → extract.json → page_job.json (in that order).
        vision_cache_src: dict[str, Any] | None = prev.vision_cache if prev else None

        if not vision_cache_src:
            disk = _read_extract_json(game_id)
            if disk and disk.get("job_id") == jid and disk.get("vision_cache"):
                vision_cache_src = disk["vision_cache"]
                logger.info("extract resume: restored vision_cache from extract.json for job %s", jid)

        if not vision_cache_src:
            try:
                pj_path = game_page_job_json(game_id)
                if pj_path.is_file():
                    pj = json.loads(pj_path.read_text(encoding="utf-8"))
                    vision_cache_src = {
                        "page_rows": pj.get("page_rows", []),
                        "toc_page_indices": [],
                        "exclude_page_indices": [],
                        "body_page_indices": [],
                        "source_file": pj.get("source_name", "resumed"),
                        "source_url": None,
                        "force_full_pipeline": False,
                    }
                    logger.info("extract resume: rebuilt vision_cache from page_job.json for game_id=%s", game_id)
            except Exception:  # noqa: BLE001
                logger.warning("extract resume: failed to read page_job.json", exc_info=True)

        if not vision_cache_src:
            raise HTTPException(
                status_code=400,
                detail="Cannot resume: vision cache not found (process may have restarted — re-upload the rulebook)",
            )

        gn = game_name if game_name is not None else ((prev.game_name if prev else None) or "")
        tc = terminology_context if terminology_context is not None else ((prev.terminology_context if prev else None) or "")
        vc = vision_cache_src
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
            "force_full_pipeline": bool(vc.get("force_full_pipeline")),
            "errors": [],
            "retry_count": 0,
        }
        _validate_rasterized_pages(
            list(initial["page_rows"]),
            list(initial["toc_page_indices"]),
            list(initial["body_page_indices"]),
        )
        with _jobs_lock:
            existing = _jobs.get(jid)
        if existing:
            with _jobs_lock:
                existing.status = JobStatus.pending
                existing.error = None
                existing.result = None
                existing.thread_id = thread_id
                existing.game_id = game_id
                existing.game_name = gn
                existing.terminology_context = tc
                existing.vision_cache = vc
                existing.ai_snapshot = snapshot
        else:
            with _jobs_lock:
                _jobs[jid] = ExtractJob(
                    status=JobStatus.pending,
                    thread_id=thread_id,
                    game_id=game_id,
                    game_name=gn,
                    terminology_context=tc,
                    vision_cache=vc,
                    ai_snapshot=snapshot,
                )
        _write_extract_json(jid, game_id, JobStatus.pending, thread_id, None, None, vc, snapshot)

    else:
        if not page_job_id:
            raise HTTPException(
                status_code=400,
                detail="`page_job_id` is required (call POST /extract/pages first to rasterize the rulebook)",
            )
        pr = get_job(page_job_id)
        if not pr:
            raise HTTPException(status_code=404, detail="Unknown page_job_id; prepare pages again")

        toc_from_request = _parse_index_list(toc_page_indices, field_name="toc_page_indices")
        exclude = _parse_index_list(exclude_page_indices, field_name="exclude_page_indices")

        page_rows = _build_page_rows(pr.pages)
        if not page_rows:
            raise HTTPException(status_code=400, detail="Page job has no pages")

        explicit_toc = len(toc_from_request) > 0
        toc = list(toc_from_request) if explicit_toc else []
        total_pages = len(page_rows)
        if explicit_toc:
            body = _compute_body_page_indices(page_rows, toc, exclude)
        else:
            body = _all_body_pages_excluding_only_ads(page_rows, exclude)
        if not body:
            raise HTTPException(
                status_code=400,
                detail="No body pages after excluding TOC and ads; adjust toc_page_indices / exclude_page_indices",
            )
        _validate_rasterized_pages(page_rows, toc, body)

        logger.info(
            "extract start: game_id=%s job_id=%s explicit_toc=%s toc_pages=%s total_pages=%s body_pages=%s exclude_pages=%s",
            game_id, jid, explicit_toc, toc, total_pages, len(body), len(exclude),
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
            "force_full_pipeline": force_full,
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
            "force_full_pipeline": force_full,
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
                ai_snapshot=snapshot,
            )
        _write_extract_json(jid, game_id, JobStatus.pending, thread_id, None, None, vision_cache, snapshot)

    background_tasks.add_task(_run_sync, jid, initial, snapshot)

    with _jobs_lock:
        j = _jobs.setdefault(jid, ExtractJob(thread_id=thread_id, game_id=game_id))
        j.thread_id = thread_id
        j.game_id = game_id

    return ExtractJobResponse(job_id=jid, status=JobStatus.pending, thread_id=thread_id, game_id=game_id)


@router.get("/games/{game_id}/extract/{job_id}", response_model=ExtractPollResponse)
async def get_extract_job(game_id: str, job_id: str) -> ExtractPollResponse:
    """Poll extract job status. Uses game_id to locate on-disk state after process restarts."""
    with _jobs_lock:
        job = _jobs.get(job_id)

    if job:
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
            complexity=res.get("complexity"),
            extraction_profile=res.get("extraction_profile"),
            toc=res.get("toc"),
        )

    # Memory miss — process may have restarted; fall back to disk.
    disk_response = _poll_response_from_disk(job_id, game_id)
    if disk_response:
        return disk_response

    raise HTTPException(status_code=404, detail="Job not found")
