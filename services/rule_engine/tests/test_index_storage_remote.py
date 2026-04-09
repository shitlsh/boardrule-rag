"""Tests for Supabase Storage index bundle helpers."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from ingestion.index_storage_remote import (
    _zip_game_dir,
    ensure_game_index_local,
    remote_index_storage_enabled,
)


def test_remote_disabled_by_default() -> None:
    with patch.dict(os.environ, {}, clear=True):
        assert remote_index_storage_enabled() is False


def test_remote_enabled_with_supabase_env() -> None:
    env = {
        "INDEX_STORAGE_MODE": "supabase",
        "SUPABASE_URL": "http://127.0.0.1:54321",
        "SUPABASE_SERVICE_ROLE_KEY": "test-key",
    }
    with patch.dict(os.environ, env, clear=True):
        assert remote_index_storage_enabled() is True


def test_zip_roundtrip(tmp_path: Path) -> None:
    root = tmp_path / "g1"
    root.mkdir()
    (root / "manifest.json").write_text(json.dumps({"game_id": "g1"}), encoding="utf-8")
    sub = root / "bm25"
    sub.mkdir()
    (sub / "x.txt").write_text("bm25", encoding="utf-8")
    raw = _zip_game_dir(root)
    out = tmp_path / "out"
    out.mkdir()
    from ingestion.index_storage_remote import _unzip_to_game_dir

    _unzip_to_game_dir(raw, out)
    assert (out / "manifest.json").is_file()
    assert json.loads((out / "manifest.json").read_text(encoding="utf-8"))["game_id"] == "g1"
    assert (out / "bm25" / "x.txt").read_text(encoding="utf-8") == "bm25"


def test_ensure_download_extracts(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    root = tmp_path / "idx"
    root.mkdir()
    (root / "manifest.json").write_text("{}", encoding="utf-8")
    bundle = _zip_game_dir(root)

    env = {
        "INDEX_STORAGE_MODE": "supabase",
        "SUPABASE_URL": "http://example.test",
        "SUPABASE_SERVICE_ROLE_KEY": "k",
        "INDEX_STORAGE_BUCKET": "boardrule-indexes",
    }
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    def fake_game_dir(_gid: str) -> Path:
        return tmp_path / "game" / "abc"

    with patch("ingestion.index_builder.game_index_dir", fake_game_dir):
        with patch("httpx.Client") as client_cls:
            resp = httpx.Response(200, content=bundle)
            client_cls.return_value.__enter__.return_value.get.return_value = resp
            ensure_game_index_local("any")

    assert (tmp_path / "game" / "abc" / "manifest.json").is_file()
