"""X-Boardrule-Ai-Config JSON (v2) parsing."""

from utils.ai_gateway import BoardruleAiConfigV2, BoardruleAiConfigV3, parse_boardrule_ai_header


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
    cfg = BoardruleAiConfigV2.model_validate_json(raw)
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
    cfg = BoardruleAiConfigV2.model_validate_json(raw)
    assert cfg.slots.embed.provider == "qwen"
    assert cfg.slots.chat.provider == "qwen"
    assert cfg.slots.chat.model == "qwen-turbo"
    assert cfg.slots.embed.dashscope_compatible_base is not None
    assert "compatible-mode" in cfg.slots.embed.dashscope_compatible_base


def test_boardrule_ai_config_v3_fine_slots_and_runtime() -> None:
    raw = """
    {
      "version": 3,
      "slots": {
        "flash": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.0-flash"},
        "pro": {"provider": "gemini", "apiKey": "k", "model": "models/gemini-2.5-pro"},
        "embed": {"provider": "gemini", "apiKey": "k", "model": "models/text-embedding-004"},
        "chat": {"provider": "gemini", "apiKey": "k", "model": "m", "temperature": 0.2, "maxTokens": 8192},
        "flashToc": {"provider": "gemini", "apiKey": "k", "model": "toc-model", "maxOutputTokens": 100},
        "proExtract": {"provider": "gemini", "apiKey": "k", "model": "extract-model"}
      },
      "extractionRuntime": {"visionBatchPages": 3}
    }
    """
    cfg = parse_boardrule_ai_header(raw)
    assert isinstance(cfg, BoardruleAiConfigV3)
    assert cfg.slots.flash_toc is not None
    assert cfg.slots.flash_toc.model == "toc-model"
    assert cfg.extraction_runtime is not None
    assert cfg.extraction_runtime.vision_batch_pages == 3


def test_boardrule_ai_config_v3_extraction_runtime_legacy_merge_key() -> None:
    """BFF may still send legacy camelCase geminiVisionMaxMergePages."""
    raw = """
    {
      "version": 3,
      "slots": {
        "flash": {"provider": "gemini", "apiKey": "k", "model": "f"},
        "pro": {"provider": "gemini", "apiKey": "k", "model": "p"},
        "embed": {"provider": "gemini", "apiKey": "k", "model": "e"},
        "chat": {"provider": "gemini", "apiKey": "k", "model": "c", "temperature": 0.2, "maxTokens": 8192}
      },
      "extractionRuntime": {"geminiVisionMaxMergePages": 20}
    }
    """
    cfg = parse_boardrule_ai_header(raw)
    assert isinstance(cfg, BoardruleAiConfigV3)
    assert cfg.extraction_runtime is not None
    assert cfg.extraction_runtime.vision_max_merge_pages == 20


def test_boardrule_ai_config_v3_extraction_runtime_vision_max_merge_key() -> None:
    raw = """
    {
      "version": 3,
      "slots": {
        "flash": {"provider": "gemini", "apiKey": "k", "model": "f"},
        "pro": {"provider": "gemini", "apiKey": "k", "model": "p"},
        "embed": {"provider": "gemini", "apiKey": "k", "model": "e"},
        "chat": {"provider": "gemini", "apiKey": "k", "model": "c", "temperature": 0.2, "maxTokens": 8192}
      },
      "extractionRuntime": {"visionMaxMergePages": 22}
    }
    """
    cfg = parse_boardrule_ai_header(raw)
    assert isinstance(cfg, BoardruleAiConfigV3)
    assert cfg.extraction_runtime is not None
    assert cfg.extraction_runtime.vision_max_merge_pages == 22
