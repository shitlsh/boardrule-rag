"""LangGraph six-node extraction pipeline with a Postgres checkpointer."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from graphs.nodes import (
    batch_splitter,
    chapter_extract,
    merge_and_refine,
    quickstart_and_questions,
    route_by_complexity,
    toc_analyzer,
)
from graphs.state import ExtractionState

logger = logging.getLogger("boardrule.graph")


def _trace_node(name: str, fn: Callable[[ExtractionState], dict]) -> Callable[[ExtractionState], dict]:
    """Log each node entry/exit so long Gemini calls show where the graph is blocked."""

    def wrapped(state: ExtractionState) -> dict:
        logger.info("graph node %s: start", name)
        try:
            out = fn(state)
            logger.info("graph node %s: done", name)
            return out
        except Exception:
            logger.exception("graph node %s: raised", name)
            raise

    return wrapped


def build_extraction_graph(checkpointer: BaseCheckpointSaver | None = None):
    builder = StateGraph(ExtractionState)
    builder.add_node("toc_analyzer", _trace_node("toc_analyzer", toc_analyzer.run))
    builder.add_node("route_by_complexity", _trace_node("route_by_complexity", route_by_complexity.run))
    builder.add_node("batch_splitter", _trace_node("batch_splitter", batch_splitter.run))
    builder.add_node("chapter_extract", _trace_node("chapter_extract", chapter_extract.run))
    builder.add_node("merge_and_refine", _trace_node("merge_and_refine", merge_and_refine.run))
    builder.add_node("quickstart_and_questions", _trace_node("quickstart_and_questions", quickstart_and_questions.run))

    builder.add_edge(START, "toc_analyzer")
    builder.add_edge("toc_analyzer", "route_by_complexity")
    builder.add_edge("route_by_complexity", "batch_splitter")
    builder.add_edge("batch_splitter", "chapter_extract")
    builder.add_edge("chapter_extract", "merge_and_refine")
    builder.add_edge("merge_and_refine", "quickstart_and_questions")
    builder.add_edge("quickstart_and_questions", END)

    return builder.compile(checkpointer=checkpointer)


def get_extraction_mermaid_text() -> str:
    """Return Mermaid diagram source for the extraction graph topology (same nodes/edges as production)."""
    # Checkpointer does not affect graph shape; omit so this works without DB / app init.
    # ``build_extraction_graph`` already returns ``builder.compile(...)`` (CompiledStateGraph).
    return build_extraction_graph(None).get_graph().draw_mermaid()


def run_extraction(
    graph: Any,
    initial: ExtractionState,
    *,
    thread_id: str,
) -> ExtractionState:
    """Run the graph synchronously with checkpointing keyed by thread_id."""
    config: dict = {"configurable": {"thread_id": thread_id}}
    result = graph.invoke(initial, config)
    return result  # type: ignore[return-value]
