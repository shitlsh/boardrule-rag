#!/usr/bin/env python3
"""Print LangGraph Mermaid for the extraction pipeline (no DB). Optional doc sync: redirect to a file."""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from graphs.extraction_graph import get_extraction_mermaid_text  # noqa: E402

if __name__ == "__main__":
    print(get_extraction_mermaid_text())
