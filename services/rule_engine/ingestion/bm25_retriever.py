"""BM25 retriever with persisted tokenization settings (LlamaIndex default omits them)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

import bm25s
import numpy as np
from llama_index.core.constants import DEFAULT_SIMILARITY_TOP_K
from llama_index.core.schema import BaseNode, IndexNode, NodeWithScore, QueryBundle
from llama_index.core.vector_stores.types import MetadataFilters
from llama_index.core.vector_stores.utils import metadata_dict_to_node
from llama_index.retrievers.bm25 import BM25Retriever

# Character-level CJK runs plus Latin alphanumerics; no extra deps (see plan).
BM25_CJK_TOKEN_PATTERN = r"(?u)(?:[\u4e00-\u9fff]+|[a-zA-Z0-9]+)"

# Empty list: do not apply English (or other) stopword lists to mixed zh/en corpora.
BM25_EMPTY_STOPWORDS: list[str] = []


class BoardruleBM25Retriever(BM25Retriever):
    """
    Extends LlamaIndex ``BM25Retriever`` so ``token_pattern``, ``skip_stemming``, and
    ``language`` (bm25s ``stopwords``) round-trip through ``persist`` / ``from_persist_dir``,
    and query tokenization matches indexing.
    """

    def __init__(
        self,
        nodes: Optional[List[BaseNode]] = None,
        stemmer: Any = None,
        language: Union[str, List[str]] = "en",
        existing_bm25: Optional[bm25s.BM25] = None,
        similarity_top_k: int = DEFAULT_SIMILARITY_TOP_K,
        callback_manager: Any = None,
        objects: Optional[List[IndexNode]] = None,
        object_map: Optional[dict] = None,
        verbose: bool = False,
        skip_stemming: bool = False,
        token_pattern: str = r"(?u)\b\w\w+\b",
        filters: Optional[MetadataFilters] = None,
        corpus_weight_mask: Optional[List[int]] = None,
    ) -> None:
        self._bm25_stopwords: Union[str, List[str]] = language
        super().__init__(
            nodes=nodes,
            stemmer=stemmer,
            language=language,
            existing_bm25=existing_bm25,
            similarity_top_k=similarity_top_k,
            callback_manager=callback_manager,
            objects=objects,
            object_map=object_map,
            verbose=verbose,
            skip_stemming=skip_stemming,
            token_pattern=token_pattern,
            filters=filters,
            corpus_weight_mask=corpus_weight_mask,
        )

    def get_persist_args(self) -> Dict[str, Any]:
        d = super().get_persist_args()
        d["token_pattern"] = self.token_pattern
        d["skip_stemming"] = self.skip_stemming
        d["language"] = self._bm25_stopwords
        return d

    def _retrieve(self, query_bundle: QueryBundle) -> List[NodeWithScore]:
        query = query_bundle.query_str
        tokenized_query = bm25s.tokenize(
            query,
            stopwords=self._bm25_stopwords,
            stemmer=self.stemmer if not self.skip_stemming else None,
            token_pattern=self.token_pattern,
            show_progress=self._verbose,
        )
        indexes, scores = self.bm25.retrieve(
            tokenized_query,
            k=self.similarity_top_k,
            show_progress=self._verbose,
            weight_mask=np.array(self.corpus_weight_mask)
            if self.corpus_weight_mask
            else None,
        )
        indexes = indexes[0]
        scores = scores[0]
        nodes: List[NodeWithScore] = []
        for idx, score in zip(indexes, scores):
            if isinstance(idx, dict):
                node = metadata_dict_to_node(idx)
            else:
                node_dict = self.corpus[int(idx)]
                node = metadata_dict_to_node(node_dict)
            nodes.append(NodeWithScore(node=node, score=float(score)))
        return nodes


def default_bm25_from_nodes(
    nodes: List[BaseNode],
    *,
    similarity_top_k: int = 12,
    token_pattern: str = BM25_CJK_TOKEN_PATTERN,
) -> BoardruleBM25Retriever:
    """BM25 with CJK-friendly tokenization and no stemming (stable for zh/en mixed text)."""
    return BoardruleBM25Retriever.from_defaults(
        nodes=nodes,
        similarity_top_k=similarity_top_k,
        skip_stemming=True,
        token_pattern=token_pattern,
        language=BM25_EMPTY_STOPWORDS,
    )
