"""X-Boardrule-Ai-Config JSON (v2) parsing."""

from utils.ai_gateway import BoardruleAiConfig


def test_boardrule_ai_config_v2_slots() -> None:
    raw = """
    {
      "version": 2,
      "slots": {
        "flash": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.0-flash", "maxOutputTokens": 8192},
        "pro": {"provider": "openrouter", "apiKey": "rk", "model": "openai/gpt-4o", "maxOutputTokens": 4096},
        "embed": {"provider": "gemini", "apiKey": "k", "model": "models/text-embedding-004"},
        "chat": {"provider": "openrouter", "apiKey": "rk", "model": "anthropic/claude-3.5-sonnet", "temperature": 0.2, "maxTokens": 8192}
      }
    }
    """
    cfg = BoardruleAiConfig.model_validate_json(raw)
    assert cfg.version == 2
    assert cfg.slots.flash.provider == "gemini"
    assert cfg.slots.pro.provider == "openrouter"
    assert cfg.slots.pro.model == "openai/gpt-4o"
    assert cfg.slots.chat.max_tokens == 8192


def test_boardrule_ai_config_v2_qwen_chat() -> None:
    raw = """
    {
      "version": 2,
      "slots": {
        "flash": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.0-flash", "maxOutputTokens": 8192},
        "pro": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.5-pro", "maxOutputTokens": 4096},
        "embed": {
            "provider": "qwen",
            "apiKey": "qk",
            "model": "text-embedding-v4",
            "dashscopeCompatibleBase": "https://dashscope.aliyuncs.com/compatible-mode/v1"
        },
        "chat": {
            "provider": "qwen",
            "apiKey": "qk",
            "model": "qwen-turbo",
            "temperature": 0.2,
            "maxTokens": 8192,
            "dashscopeCompatibleBase": "https://dashscope.aliyuncs.com/compatible-mode/v1"
        }
      }
    }
    """
    cfg = BoardruleAiConfig.model_validate_json(raw)
    assert cfg.slots.embed.provider == "qwen"
    assert cfg.slots.chat.provider == "qwen"
    assert cfg.slots.chat.model == "qwen-turbo"
    assert cfg.slots.embed.dashscope_compatible_base is not None
    assert "compatible-mode" in cfg.slots.embed.dashscope_compatible_base
