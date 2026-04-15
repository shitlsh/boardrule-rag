"""Registry for prepared page raster jobs (before extraction).

Jobs are registered in memory when ``POST /extract/pages`` completes. The same payload is
written to ``page_job.json`` under the game directory; after a process restart the in-memory map
is empty, so we rehydrate from disk when ``page_job_id`` matches that file.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

from ingestion.page_raster import PageAsset
from utils.paths import game_page_job_json

_lock = Lock()
_jobs: dict[str, "PageRasterJob"] = {}
logger = logging.getLogger("boardrule.page_jobs")


@dataclass
class PageRasterJob:
    job_id: str
    source_name: str
    pages: list[PageAsset]
    meta: dict[str, Any] = field(default_factory=dict)


def register_job(job_id: str, source_name: str, pages: list[PageAsset], meta: dict[str, Any]) -> PageRasterJob:
    job = PageRasterJob(job_id=job_id, source_name=source_name, pages=pages, meta=meta)
    with _lock:
        _jobs[job_id] = job
    return job


def get_job(job_id: str) -> PageRasterJob | None:
    with _lock:
        return _jobs.get(job_id)


def _load_page_raster_job_from_disk(game_id: str, job_id: str) -> PageRasterJob | None:
    """Rebuild ``PageRasterJob`` from ``page_job.json`` if ``page_job_id`` matches."""
    pj_path = game_page_job_json(game_id)
    if not pj_path.is_file():
        return None
    try:
        data = json.loads(pj_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if data.get("page_job_id") != job_id:
        return None
    rows = data.get("page_rows")
    if not isinstance(rows, list) or not rows:
        return None
    pages: list[PageAsset] = []
    for r in rows:
        if not isinstance(r, dict):
            return None
        try:
            pnum = int(r["page"])
            pth = Path(str(r["path"]))
        except (KeyError, TypeError, ValueError):
            return None
        try:
            pth = pth.resolve()
        except OSError:
            return None
        if not pth.is_file():
            logger.warning(
                "page_job restore: missing file for game_id=%s job_id=%s path=%s",
                game_id,
                job_id,
                pth,
            )
            return None
        pages.append(PageAsset(page=pnum, path=pth))
    if not pages:
        return None
    meta = data["meta"] if isinstance(data.get("meta"), dict) else {}
    source_name = str(data.get("source_name") or "restored")
    return PageRasterJob(job_id=job_id, source_name=source_name, pages=pages, meta=meta)


def get_job_or_restore(game_id: str, job_id: str) -> PageRasterJob | None:
    """Return a prepared page job from memory, or rehydrate from ``page_job.json`` after restart."""
    with _lock:
        hit = _jobs.get(job_id)
    if hit:
        return hit
    restored = _load_page_raster_job_from_disk(game_id, job_id)
    if restored is None:
        return None
    with _lock:
        _jobs[job_id] = restored
    return restored


def delete_job(job_id: str) -> None:
    with _lock:
        _jobs.pop(job_id, None)
