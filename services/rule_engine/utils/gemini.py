"""Backward-compatible shim: multi-provider LLM helpers live in ``llm_generate``."""

from __future__ import annotations

from utils.llm_generate import (
    FLASH_QUICKSTART,
    FLASH_TOC,
    PRO_EXTRACT,
    PRO_MERGE,
    GeminiCallMeta,
    LlmCallMeta,
    build_labeled_image_parts,
    flash_max_output_tokens,
    generate_flash,
    generate_flash_vision,
    generate_pro,
    generate_pro_vision,
    pro_max_output_tokens,
)

__all__ = [
    "FLASH_QUICKSTART",
    "FLASH_TOC",
    "PRO_EXTRACT",
    "PRO_MERGE",
    "GeminiCallMeta",
    "LlmCallMeta",
    "build_labeled_image_parts",
    "flash_max_output_tokens",
    "generate_flash",
    "generate_flash_vision",
    "generate_pro",
    "generate_pro_vision",
    "pro_max_output_tokens",
]
