"""Read-only graph metadata (Mermaid) for operator UI."""

from __future__ import annotations

from fastapi import APIRouter

from graphs.extraction_graph import get_extraction_mermaid_text

router = APIRouter(tags=["graph"])


@router.get("/graph/extraction-mermaid")
def extraction_mermaid() -> dict[str, str]:
    """LangGraph ``draw_mermaid()`` for the live extraction pipeline (topology follows code)."""
    return {"mermaid": get_extraction_mermaid_text()}
