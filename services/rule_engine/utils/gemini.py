"""Gemini client wrapper (Flash / Pro, temperature, max output tokens)."""

from __future__ import annotations

import os

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
