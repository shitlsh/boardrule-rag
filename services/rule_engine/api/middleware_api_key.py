"""Optional shared secret for HTTP access (BFF → rule_engine)."""

from __future__ import annotations

import os

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class RuleEngineApiKeyMiddleware(BaseHTTPMiddleware):
    """Require ``Authorization: Bearer <RULE_ENGINE_API_KEY>`` or ``X-API-Key`` when the env var is set."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path == "/health":
            return await call_next(request)
        # Rasterized page PNGs for <img src>; browsers cannot send Bearer / X-API-Key.
        if path == "/page-assets" or path.startswith("/page-assets/"):
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)
        expected = (os.environ.get("RULE_ENGINE_API_KEY") or "").strip()
        if not expected:
            return await call_next(request)
        auth_h = request.headers.get("authorization") or ""
        token_ok = auth_h.startswith("Bearer ") and auth_h[7:].strip() == expected
        x_ok = (request.headers.get("x-api-key") or "").strip() == expected
        if not token_ok and not x_ok:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        return await call_next(request)
