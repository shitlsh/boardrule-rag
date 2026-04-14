"""Normalize Bedrock foundation model IDs for Runtime ``Converse``.

``ListFoundationModels`` returns per-context variants (e.g. ``...:0:300k``) that are not valid
``modelId`` values for ``converse`` — use the base ID (e.g. ``...:0``). See ``apps/web/lib/bedrock-models-list.ts``.
"""

from __future__ import annotations

import re

_VARIANT = re.compile(
    r"^(.+):(\d+):(\d+k|mm|8k|20k|28k|48k|200k|256k|1000k|512|128k)$",
    re.IGNORECASE,
)


def canonical_bedrock_converse_model_id(model_id: str) -> str:
    t = model_id.strip()
    for _ in range(4):
        m = _VARIANT.match(t)
        if not m:
            break
        t = f"{m.group(1)}:{m.group(2)}"
    return t
