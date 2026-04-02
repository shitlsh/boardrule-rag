"""Gemini client wrapper (Flash / Pro, text + multimodal vision)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import google.generativeai as genai


def _configure() -> None:
    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_API_KEY is not set")
    genai.configure(api_key=key)


def flash_model_name() -> str:
    return os.environ.get("GEMINI_FLASH_MODEL", "gemini-2.0-flash")


def pro_model_name() -> str:
    return os.environ.get("GEMINI_PRO_MODEL", "gemini-1.5-pro")


def pro_max_output_tokens() -> int:
    raw = os.environ.get("GEMINI_PRO_MAX_OUTPUT_TOKENS", "8192").strip()
    return int(raw) if raw.isdigit() else 8192


def generate_flash(
    prompt: str,
    *,
    temperature: float = 0.2,
    max_output_tokens: int = 8192,
) -> str:
    _configure()
    model = genai.GenerativeModel(
        flash_model_name(),
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        ),
    )
    response = model.generate_content(prompt)
    if not response.text:
        raise RuntimeError("Gemini Flash returned empty response")
    return response.text


def generate_pro(
    prompt: str,
    *,
    temperature: float = 0.0,
    max_output_tokens: int = 8192,
) -> str:
    _configure()
    model = genai.GenerativeModel(
        pro_model_name(),
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        ),
    )
    response = model.generate_content(prompt)
    if not response.text:
        raise RuntimeError("Gemini Pro returned empty response")
    return response.text


def _pil_open(path: Path | str):
    from PIL import Image

    p = Path(path) if isinstance(path, str) else path
    return Image.open(p).convert("RGB")


def build_labeled_image_parts(
    labeled_pages: list[tuple[int, Path]],
    *,
    preamble: str = "",
    closing: str = "",
) -> list[Any]:
    """
    Interleave explicit page labels with images to reduce page-number hallucination.

    Each item is (1-based physical page number, image path).
    """
    parts: list[Any] = []
    if preamble:
        parts.append(preamble)
    for page_num, img_path in labeled_pages:
        parts.append(f"以下是第 {page_num} 页（物理页码 {page_num}）：")
        parts.append(_pil_open(img_path))
    if closing:
        parts.append(closing)
    return parts


def generate_flash_vision(
    parts: list[Any],
    *,
    temperature: float = 0.1,
    max_output_tokens: int = 8192,
) -> str:
    """Multimodal Flash (images + text parts)."""
    _configure()
    model = genai.GenerativeModel(
        flash_model_name(),
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        ),
    )
    response = model.generate_content(parts)
    if not response.text:
        raise RuntimeError("Gemini Flash returned empty response (vision)")
    return response.text


def generate_pro_vision(
    parts: list[Any],
    *,
    temperature: float = 0.0,
    max_output_tokens: int | None = None,
) -> str:
    """Multimodal Pro (images + text parts)."""
    _configure()
    mot = max_output_tokens if max_output_tokens is not None else pro_max_output_tokens()
    model = genai.GenerativeModel(
        pro_model_name(),
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=mot,
        ),
    )
    response = model.generate_content(parts)
    if not response.text:
        raise RuntimeError("Gemini Pro returned empty response (vision)")
    return response.text
