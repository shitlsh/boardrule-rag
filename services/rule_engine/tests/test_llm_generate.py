"""Defaults and env overrides for ``utils.llm_generate``."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from utils.ai_gateway import BoardruleAiConfig, boardrule_ai_runtime


def _v2_cfg(*, pro_max_tokens: int | None = None) -> BoardruleAiConfig:
    pro: dict = {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.5-pro"}
    if pro_max_tokens is not None:
        pro["maxOutputTokens"] = pro_max_tokens
    raw = {
        "version": 2,
        "slots": {
            "flash": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.0-flash"},
            "pro": pro,
            "embed": {"provider": "gemini", "apiKey": "k", "model": "models/text-embedding-004"},
            "chat": {
                "provider": "openrouter",
                "apiKey": "rk",
                "model": "x",
                "temperature": 0.2,
                "maxTokens": 8192,
            },
        },
    }
    return BoardruleAiConfig.model_validate(raw)


def test_pro_max_output_defaults_to_32k_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BOARDRULE_PRO_MAX_OUTPUT_TOKENS_DEFAULT", raising=False)
    cfg = _v2_cfg()
    from utils.llm_generate import pro_max_output_tokens

    with boardrule_ai_runtime(cfg):
        assert pro_max_output_tokens() == 32768


def test_pro_max_output_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BOARDRULE_PRO_MAX_OUTPUT_TOKENS_DEFAULT", "4096")
    cfg = _v2_cfg()
    from utils.llm_generate import pro_max_output_tokens

    with boardrule_ai_runtime(cfg):
        assert pro_max_output_tokens() == 4096


def test_pro_max_output_bff_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BOARDRULE_PRO_MAX_OUTPUT_TOKENS_DEFAULT", "8192")
    cfg = _v2_cfg(pro_max_tokens=16384)
    from utils.llm_generate import pro_max_output_tokens

    with boardrule_ai_runtime(cfg):
        assert pro_max_output_tokens() == 16384


def test_openrouter_chat_completion_returns_finish_reason() -> None:
    fake = {"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}]}
    with patch("utils.openrouter_client.httpx.Client") as m_client:
        m_inst = MagicMock()
        m_resp = MagicMock()
        m_resp.raise_for_status = MagicMock()
        m_resp.json.return_value = fake
        m_inst.post.return_value = m_resp
        m_client.return_value.__enter__.return_value = m_inst
        from utils.openrouter_client import chat_completion_with_meta

        text, fr = chat_completion_with_meta(
            api_key="k",
            model="m",
            messages=[{"role": "user", "content": "x"}],
            temperature=0.0,
            max_tokens=100,
        )
        assert text == "hi"
        assert fr == "stop"
