"""Reuse SentenceTransformerRerank / CrossEncoder across chat and smoke-retrieve (first load is slow)."""

from __future__ import annotations

import threading

from llama_index.core.postprocessor import SentenceTransformerRerank

_lock = threading.Lock()
_cache: dict[tuple[str, int], SentenceTransformerRerank] = {}


def get_cached_sentence_transformer_rerank(*, model: str, top_n: int) -> SentenceTransformerRerank:
    """One CrossEncoder per (model, top_n); avoids reloading weights on every /chat request."""
    key = (model, top_n)
    with _lock:
        if key in _cache:
            return _cache[key]
    # Never load PyTorch / download weights while holding the lock: first load can take minutes
    # and would block every other /chat and smoke-retrieve caller.
    instance = SentenceTransformerRerank(model=model, top_n=top_n)
    with _lock:
        if key not in _cache:
            _cache[key] = instance
        return _cache[key]
