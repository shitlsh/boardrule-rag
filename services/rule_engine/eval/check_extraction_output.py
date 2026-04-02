#!/usr/bin/env python3
"""Check merged rule Markdown for acceptance: word count and page anchors."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

_PAGE_RE = re.compile(r"<!--\s*pages:\s*[^>]+\s*-->", re.IGNORECASE)


def main() -> int:
    p = argparse.ArgumentParser(description="Validate merged extraction markdown.")
    p.add_argument("path", type=Path, help="Path to merged .md file")
    p.add_argument("--min-words", type=int, default=0, help="Minimum word count (whitespace split)")
    p.add_argument("--min-page-markers", type=int, default=0, help="Minimum <!-- pages: --> markers")
    args = p.parse_args()
    text = args.path.read_text(encoding="utf-8")
    words = len(text.split())
    markers = len(_PAGE_RE.findall(text))
    ok = True
    if words < args.min_words:
        print(f"FAIL: words={words} < {args.min_words}", file=sys.stderr)
        ok = False
    if markers < args.min_page_markers:
        print(f"FAIL: page_markers={markers} < {args.min_page_markers}", file=sys.stderr)
        ok = False
    print(f"words={words} page_markers={markers} path={args.path}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
