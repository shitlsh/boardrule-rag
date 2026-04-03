"""Compiled extraction graph for LangGraph CLI / Studio.

Uses ``checkpointer=None`` so the graph can load without PostgreSQL. The FastAPI
app still compiles the same pipeline with ``PostgresSaver`` at runtime; see
``api.main`` and ``graphs.extraction_graph.build_extraction_graph``.
"""

from __future__ import annotations

from graphs.extraction_graph import build_extraction_graph

graph = build_extraction_graph()
