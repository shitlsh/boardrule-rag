"""FastAPI dependencies."""

from __future__ import annotations

from fastapi import HTTPException, Request

from utils.ai_gateway import BoardruleAiConfig


def require_boardrule_ai(request: Request) -> BoardruleAiConfig:
    if getattr(request.state, "boardrule_ai_invalid", False):
        raise HTTPException(status_code=400, detail="Invalid X-Boardrule-Ai-Config JSON")
    cfg = getattr(request.state, "boardrule_ai", None)
    if cfg is None:
        raise HTTPException(status_code=400, detail="X-Boardrule-Ai-Config header is required")
    return cfg
