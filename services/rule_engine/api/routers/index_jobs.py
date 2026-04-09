"""In-memory async jobs for POST /build-index/start (same process as API worker)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal

JobStatus = Literal["pending", "processing", "completed", "failed"]


@dataclass
class BuildIndexJob:
    status: JobStatus = "pending"
    manifest: dict[str, Any] | None = None
    error: str | None = None


_jobs: dict[str, BuildIndexJob] = {}
_lock = Lock()


def create_job() -> str:
    jid = str(uuid.uuid4())
    with _lock:
        _jobs[jid] = BuildIndexJob()
    return jid


def get_job(job_id: str) -> BuildIndexJob | None:
    with _lock:
        j = _jobs.get(job_id)
        return BuildIndexJob(status=j.status, manifest=j.manifest, error=j.error) if j else None


def set_processing(job_id: str) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].status = "processing"


def set_completed(job_id: str, manifest: dict[str, Any]) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].status = "completed"
            _jobs[job_id].manifest = manifest
            _jobs[job_id].error = None


def set_failed(job_id: str, error: str) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].status = "failed"
            _jobs[job_id].error = error
