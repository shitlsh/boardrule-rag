"""HTTP rerank via Jina Cloud API (no local PyTorch)."""

from __future__ import annotations

import os
from typing import Any

import httpx
from llama_index.core.bridge.pydantic import Field
from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.schema import NodeWithScore, QueryBundle

from utils.ai_gateway import get_extraction_runtime

JINA_RERANK_URL = "https://api.jina.ai/v1/rerank"


def _jina_timeout_s() -> float:
    ms = None
    o = get_extraction_runtime()
    if o is not None and o.jina_http_timeout_ms is not None:
        ms = int(o.jina_http_timeout_ms)
    if ms is None:
        raw = (os.environ.get("JINA_HTTP_TIMEOUT_MS") or "").strip()
        if raw:
            try:
                ms = int(raw)
            except ValueError:
                ms = None
    if ms is None:
        return 120.0
    if ms <= 0:
        return 300.0
    return max(1.0, ms / 1000.0)


class JinaRerankPostprocessor(BaseNodePostprocessor):
    """Rerank retrieved nodes using ``POST /v1/rerank``."""

    api_key: str = Field(description="Jina API key (Bearer).")
    model: str = Field(description="Jina reranker model id.")
    top_n: int = Field(default=5, ge=1, le=100)

    def _postprocess_nodes(
        self,
        nodes: list[NodeWithScore],
        query_bundle: QueryBundle | None = None,
    ) -> list[NodeWithScore]:
        if not nodes or query_bundle is None:
            return nodes[: self.top_n]

        query = (query_bundle.query_str or "").strip()
        if not query:
            return nodes[: self.top_n]

        documents: list[str] = []
        for nws in nodes:
            txt = ""
            if hasattr(nws.node, "get_content"):
                txt = nws.node.get_content() or ""
            else:
                txt = str(getattr(nws.node, "text", "") or "")
            documents.append(txt if txt.strip() else " ")

        payload: dict[str, Any] = {
            "model": self.model,
            "query": query,
            "documents": documents,
            "top_n": min(self.top_n, len(documents)),
            "return_documents": False,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key.strip()}",
        }
        timeout = _jina_timeout_s()
        with httpx.Client(timeout=timeout) as client:
            r = client.post(JINA_RERANK_URL, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()

        results = data.get("results") or data.get("data") or []
        if not isinstance(results, list) or not results:
            return nodes[: self.top_n]

        scored: list[tuple[int, float]] = []
        for item in results:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            if not isinstance(idx, int) or idx < 0 or idx >= len(nodes):
                continue
            rs = item.get("relevance_score")
            if rs is None:
                rs = item.get("score")
            try:
                score_f = float(rs) if rs is not None else 0.0
            except (TypeError, ValueError):
                score_f = 0.0
            scored.append((idx, score_f))

        if not scored:
            return nodes[: self.top_n]

        scored.sort(key=lambda x: x[1], reverse=True)
        out: list[NodeWithScore] = []
        seen: set[int] = set()
        for idx, sc in scored:
            if idx in seen or len(out) >= self.top_n:
                continue
            seen.add(idx)
            base = nodes[idx]
            out.append(NodeWithScore(node=base.node, score=sc))
        return out
