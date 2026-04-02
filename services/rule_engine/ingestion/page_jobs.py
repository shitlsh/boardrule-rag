"""In-memory registry for prepared page raster jobs (before extraction)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

from ingestion.page_raster import PageAsset

_lock = Lock()
_jobs: dict[str, "PageRasterJob"] = {}


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


def delete_job(job_id: str) -> None:
    with _lock:
        _jobs.pop(job_id, None)
