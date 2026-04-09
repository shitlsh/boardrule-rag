"""Upload/download per-game index bundles to Supabase Storage (S3-compatible REST API)."""

from __future__ import annotations

import io
import logging
import os
import shutil
import zipfile
from pathlib import Path

import httpx

logger = logging.getLogger("boardrule.index_storage")

_BUNDLE_NAME = "bundle.zip"
_MANIFEST_NAME = "manifest.json"


def _safe_game_id(game_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in game_id.strip()) or "game"


def remote_index_storage_enabled() -> bool:
    mode = (os.environ.get("INDEX_STORAGE_MODE") or "").strip().lower()
    if mode not in ("supabase", "1", "true", "yes", "on"):
        return False
    url = (os.environ.get("SUPABASE_URL") or "").strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    return bool(url and key)


def _bucket() -> str:
    return (os.environ.get("INDEX_STORAGE_BUCKET") or "boardrule-indexes").strip()


def _object_path(game_id: str) -> str:
    return f"indexes/{_safe_game_id(game_id)}/{_BUNDLE_NAME}"


def _headers() -> dict[str, str]:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
    return {
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }


def _base_url() -> str:
    u = os.environ["SUPABASE_URL"].strip().rstrip("/")
    return u


def _zip_game_dir(root: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in root.rglob("*"):
            if path.is_file():
                arc = path.relative_to(root)
                zf.write(path, arc.as_posix())
    return buf.getvalue()


def _unzip_to_game_dir(data: bytes, root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        zf.extractall(root)


def upload_game_index_bundle_after_build(game_id: str, root: Path) -> None:
    """Zip ``root`` (per-game index dir) and upload to Storage; no-op if remote mode is off."""
    if not remote_index_storage_enabled():
        return
    if not root.is_dir():
        logger.warning("index storage upload skipped: %s is not a directory", root)
        return
    manifest = root / _MANIFEST_NAME
    if not manifest.is_file():
        logger.warning("index storage upload skipped: no %s", manifest)
        return
    data = _zip_game_dir(root)
    url = f"{_base_url()}/storage/v1/object/{_bucket()}/{_object_path(game_id)}"
    timeout = float(os.environ.get("INDEX_STORAGE_UPLOAD_TIMEOUT_SEC", "600"))
    with httpx.Client(timeout=timeout) as client:
        r = client.post(
            url,
            content=data,
            headers={
                **_headers(),
                "Content-Type": "application/zip",
                "x-upsert": "true",
            },
        )
    if r.status_code >= 400:
        raise RuntimeError(
            f"Index bundle upload failed: HTTP {r.status_code} {r.text[:500]}"
        )
    logger.info("Uploaded index bundle for game_id=%s to %s", game_id, _object_path(game_id))


def ensure_game_index_local(game_id: str) -> None:
    """
    If remote storage is configured and the local manifest is missing, download and extract
    the bundle into the same path ``game_index_dir(game_id)`` would use.
    """
    if not remote_index_storage_enabled():
        return
    from ingestion.index_builder import game_index_dir

    root = game_index_dir(game_id)
    if (root / _MANIFEST_NAME).is_file():
        return
    url = f"{_base_url()}/storage/v1/object/{_bucket()}/{_object_path(game_id)}"
    timeout = float(os.environ.get("INDEX_STORAGE_DOWNLOAD_TIMEOUT_SEC", "600"))
    with httpx.Client(timeout=timeout) as client:
        r = client.get(url, headers=_headers())
    if r.status_code == 404:
        return
    if r.status_code >= 400:
        raise RuntimeError(
            f"Index bundle download failed: HTTP {r.status_code} {r.text[:500]}"
        )
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)
    _unzip_to_game_dir(r.content, root)
    logger.info("Downloaded index bundle for game_id=%s into %s", game_id, root)
