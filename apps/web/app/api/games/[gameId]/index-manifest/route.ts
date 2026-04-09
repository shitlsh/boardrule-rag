import { NextResponse } from "next/server";

import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { ruleEngineAiHeaders } from "@/lib/rule-engine-headers";
import { assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

/** Proxies rule_engine ``GET /index/{game_id}/manifest`` so the game page can show actual index settings. */
export async function GET(_req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { gameId } = await params;
  try {
    const base = getRuleEngineBaseUrl();
    const ai = await ruleEngineAiHeaders();
    const res = await fetch(`${base}/index/${encodeURIComponent(gameId)}/manifest`, {
      method: "GET",
      headers: ai,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { message: text || `规则引擎返回 ${res.status}` },
        { status: res.status },
      );
    }
    return NextResponse.json(JSON.parse(text) as unknown);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
