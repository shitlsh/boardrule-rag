"""BM25 + dense vector retrieval merged with reciprocal rank fusion (no extra LLM)."""

from __future__ import annotations

from typing import Any

from llama_index.core.base.base_retriever import BaseRetriever
from llama_index.core.callbacks.base import CallbackManager
from llama_index.core.schema import NodeWithScore, QueryBundle


def reciprocal_rank_fusion(
    results_lists: list[list[NodeWithScore]],
    *,
    k: int = 60,
    top_k: int = 10,
) -> list[NodeWithScore]:
    """RRF merge of multiple ranked node lists."""
    scores: dict[str, float] = {}
    nodes: dict[str, NodeWithScore] = {}
    for rlist in results_lists:
        for rank, nws in enumerate(rlist, start=1):
            nid = nws.node.node_id
            scores[nid] = scores.get(nid, 0.0) + 1.0 / (k + rank)
            if nid not in nodes:
                nodes[nid] = nws
    ordered = sorted(scores.keys(), key=lambda i: scores[i], reverse=True)[:top_k]
    out: list[NodeWithScore] = []
    for nid in ordered:
        base = nodes[nid]
        out.append(NodeWithScore(node=base.node, score=scores[nid]))
    return out


class HybridFusionRetriever(BaseRetriever):
    """Runs BM25 and vector retrievers, merges with RRF."""

    def __init__(
        self,
        bm25_retriever: BaseRetriever,
        vector_retriever: BaseRetriever,
        *,
        similarity_top_k: int = 8,
        rrf_k: int = 60,
        callback_manager: CallbackManager | None = None,
        object_map: dict[str, Any] | None = None,
        objects: list[Any] | None = None,
    ) -> None:
        self._bm25 = bm25_retriever
        self._vector = vector_retriever
        self._similarity_top_k = similarity_top_k
        self._rrf_k = rrf_k
        super().__init__(
            callback_manager=callback_manager,
            object_map=object_map,
            objects=objects,
        )

    def _retrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        b = self._bm25.retrieve(query_bundle)
        v = self._vector.retrieve(query_bundle)
        return reciprocal_rank_fusion([b, v], k=self._rrf_k, top_k=self._similarity_top_k)
