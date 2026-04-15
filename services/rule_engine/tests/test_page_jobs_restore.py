"""page_job.json rehydration after restart (in-memory registry empty)."""

import json
import uuid
from pathlib import Path

import pytest

from ingestion import page_jobs as pj_mod
from utils.paths import game_dir, game_page_job_json


@pytest.fixture()
def isolated_page_assets_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setenv("PAGE_ASSETS_ROOT", str(tmp_path))
    return tmp_path


def test_get_job_or_restore_from_disk_after_memory_clear(
    isolated_page_assets_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    game_id = "g-restore-test"
    job_id = str(uuid.uuid4())
    gdir = game_dir(game_id)
    gdir.mkdir(parents=True, exist_ok=True)
    png = gdir / "page_0001.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n")

    page_rows = [{"page": 1, "path": str(png)}]
    pj_path = game_page_job_json(game_id)
    pj_path.write_text(
        json.dumps(
            {
                "page_job_id": job_id,
                "source_name": "rules.pdf",
                "page_rows": page_rows,
                "meta": {"total_pages": 1},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    assert pj_mod.get_job(job_id) is None

    restored = pj_mod.get_job_or_restore(game_id, job_id)
    assert restored is not None
    assert restored.job_id == job_id
    assert restored.source_name == "rules.pdf"
    assert len(restored.pages) == 1
    assert restored.pages[0].page == 1
    assert restored.pages[0].path.resolve() == png.resolve()

    assert pj_mod.get_job(job_id) is not None

    monkeypatch.setattr(pj_mod, "_jobs", {})
    again = pj_mod.get_job_or_restore(game_id, job_id)
    assert again is not None
    assert again.pages[0].path.resolve() == png.resolve()


def test_get_job_or_restore_wrong_id(isolated_page_assets_root: Path) -> None:
    game_id = "g-wrong"
    gdir = game_dir(game_id)
    gdir.mkdir(parents=True, exist_ok=True)
    png = gdir / "page_0001.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n")
    game_page_job_json(game_id).write_text(
        json.dumps(
            {
                "page_job_id": str(uuid.uuid4()),
                "source_name": "x",
                "page_rows": [{"page": 1, "path": str(png)}],
                "meta": {},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    assert pj_mod.get_job_or_restore(game_id, str(uuid.uuid4())) is None
