"""Amazon Bedrock Runtime ``converse`` for extraction (text + vision), IAM or API key (Bearer)."""

from __future__ import annotations

import io
import os
from typing import Any, Literal

import boto3
from botocore.config import Config

from utils.ai_gateway import ChatSlot, FlashProSlot, get_extraction_runtime

# Slots that carry Bedrock fields for Runtime ``converse`` (same shape in JSON).
BedrockLike = FlashProSlot | ChatSlot


def _bedrock_botocore_config() -> Config:
    o = get_extraction_runtime()
    ms = o.bedrock_http_timeout_ms if o is not None else None
    if ms is None or ms <= 0:
        return Config(read_timeout=120, connect_timeout=30)
    return Config(read_timeout=max(1.0, float(ms) / 1000.0), connect_timeout=30)


def _bedrock_runtime_client_iam(
    *,
    region: str,
    secret_access_key: str,
    aws_access_key_id: str | None,
    aws_session_token: str | None,
):
    """IAM (SigV4): explicit keys on the client."""
    cfg = _bedrock_botocore_config()
    return boto3.client(
        "bedrock-runtime",
        region_name=region,
        aws_access_key_id=aws_access_key_id,
        aws_secret_access_key=secret_access_key,
        aws_session_token=aws_session_token,
        config=cfg,
    )


def _bedrock_runtime_client_api_key(*, region: str):
    """Bedrock product API key: ``AWS_BEARER_TOKEN_BEDROCK`` must be set *before* ``boto3.client`` (AWS docs / boto3#4723)."""
    cfg = _bedrock_botocore_config()
    return boto3.client("bedrock-runtime", region_name=region, config=cfg)


class _BearerEnv:
    def __init__(self, token: str) -> None:
        self._key = "AWS_BEARER_TOKEN_BEDROCK"
        self._token = token
        self._prev: str | None = None

    def __enter__(self) -> None:
        self._prev = os.environ.get(self._key)
        os.environ[self._key] = self._token

    def __exit__(self, *args: object) -> None:
        if self._prev is None:
            os.environ.pop(self._key, None)
        else:
            os.environ[self._key] = self._prev


def _require_bedrock_slot(slot: BedrockLike) -> tuple[str, Literal["iam", "api_key"]]:
    if slot.provider != "bedrock":
        raise ValueError("not a Bedrock slot")
    region = (slot.bedrock_region or "").strip()
    mode = slot.bedrock_auth_mode
    if not region or mode not in ("iam", "api_key"):
        raise ValueError("Bedrock slot requires bedrockRegion and bedrockAuthMode")
    return region, mode


def _extract_output_text(response: dict[str, Any]) -> str:
    msg = response.get("output") or {}
    content = msg.get("message", {}).get("content") or []
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and "text" in block:
            parts.append(str(block["text"]))
    return "".join(parts).strip()


def _stop_truncated(stop_reason: str | None) -> bool:
    if not stop_reason:
        return False
    s = stop_reason.upper()
    return s in ("MAX_TOKENS", "LENGTH")


def converse_messages(
    slot: BedrockLike,
    *,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    """Multi-turn Converse; returns (assistant text, truncated)."""
    region, mode = _require_bedrock_slot(slot)
    body = {
        "modelId": slot.model,
        "messages": messages,
        "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
    }
    if mode == "api_key":
        token = (slot.api_key or "").strip()
        if not token:
            raise ValueError("Bedrock api_key mode requires non-empty apiKey (Bearer token)")
        with _BearerEnv(token):
            client = _bedrock_runtime_client_api_key(region=region)
            resp = client.converse(**body)
    else:
        client = _bedrock_runtime_client_iam(
            region=region,
            secret_access_key=slot.api_key,
            aws_access_key_id=(slot.aws_access_key_id or "").strip() or None,
            aws_session_token=(slot.aws_session_token or "").strip() or None,
        )
        resp = client.converse(**body)
    text = _extract_output_text(resp)
    return text, _stop_truncated(resp.get("stopReason"))


def _part_to_content_block(p: Any) -> dict[str, Any] | None:
    if isinstance(p, str):
        t = p.strip()
        return {"text": t} if t else None
    pil = getattr(p, "save", None) and getattr(p, "mode", None)
    if pil:
        buf = io.BytesIO()
        p.save(buf, format="PNG")
        raw = buf.getvalue()
        return {"image": {"format": "png", "source": {"bytes": raw}}}
    return None


def converse_user_content(
    slot: BedrockLike,
    *,
    content_blocks: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> tuple[str, bool]:
    return converse_messages(
        slot,
        messages=[{"role": "user", "content": content_blocks}],
        temperature=temperature,
        max_tokens=max_tokens,
    )


def parts_to_bedrock_content(parts: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in parts:
        b = _part_to_content_block(p)
        if b:
            out.append(b)
    return out

