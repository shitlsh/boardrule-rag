"""Tests for utils/page_markers."""

from utils.page_markers import (
    page_continuity_warnings,
    supplement_chapter_page_metadata,
    text_contains_need_more_context,
)


def test_need_more_context_detection():
    assert text_contains_need_more_context("NEED_MORE_CONTEXT: more pages")
    assert text_contains_need_more_context("prefix\nNEED_MORE_CONTEXT：中文")
    assert not text_contains_need_more_context("No marker here")


def test_page_continuity_warnings_decreasing():
    md = """<!-- pages: 10-12 -->
body
<!-- pages: 5-6 -->
more"""
    w = page_continuity_warnings(md, prefix="t")
    assert len(w) == 1
    assert "not non-decreasing" in w[0]
    assert "5" in w[0]


def test_page_continuity_warnings_ok():
    md = """<!-- pages: 1-2 -->
a
[p.3-4]
b"""
    assert page_continuity_warnings(md) == []


def test_supplement_chapter_metadata_from_brackets():
    chapters = [
        {
            "text": "Rules [p.7-9] apply here.",
            "metadata": {"game_id": "g", "source_file": "x.pdf"},
        }
    ]
    out = supplement_chapter_page_metadata(chapters)
    assert out[0]["metadata"]["page_start"] == 7
    assert out[0]["metadata"]["page_end"] == 9
    assert out[0]["metadata"]["pages"] == "7-9"


def test_supplement_skips_when_anchor_present():
    meta = {
        "game_id": "g",
        "source_file": "x.pdf",
        "page_start": 1,
        "page_end": 2,
        "pages": "1-2",
        "original_page_range": "1-2",
    }
    chapters = [{"text": "[p.99] ignored", "metadata": dict(meta)}]
    out = supplement_chapter_page_metadata(chapters)
    assert out[0]["metadata"]["page_start"] == 1
