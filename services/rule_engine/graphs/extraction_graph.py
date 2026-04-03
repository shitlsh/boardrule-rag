"""LangGraph six-node extraction pipeline with a Postgres checkpointer."""

from __future__ import annotations

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


def build_extraction_graph(checkpointer: BaseCheckpointSaver | None = None):
    builder = StateGraph(ExtractionState)
    builder.add_node("toc_analyzer", toc_analyzer.run)
    builder.add_node("route_by_complexity", route_by_complexity.run)
    builder.add_node("batch_splitter", batch_splitter.run)
    builder.add_node("chapter_extract", chapter_extract.run)
    builder.add_node("merge_and_refine", merge_and_refine.run)
    builder.add_node("quickstart_and_questions", quickstart_and_questions.run)

    builder.add_edge(START, "toc_analyzer")
    builder.add_edge("toc_analyzer", "route_by_complexity")
    builder.add_edge("route_by_complexity", "batch_splitter")
    builder.add_edge("batch_splitter", "chapter_extract")
    builder.add_edge("chapter_extract", "merge_and_refine")
    builder.add_edge("merge_and_refine", "quickstart_and_questions")
    builder.add_edge("quickstart_and_questions", END)

    return builder.compile(checkpointer=checkpointer)


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
