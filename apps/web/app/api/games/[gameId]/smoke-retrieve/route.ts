import { NextResponse } from "next/server";

import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { ruleEngineAiHeaders } from "@/lib/rule-engine-headers";
import { assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ gameId: string }> };

/** Proxies rule_engine ``GET /index/{game_id}/smoke-retrieve`` (hybrid + rerank, no LLM answer). */
export async function GET(req: Request, { params }: RouteParams) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { gameId } = await params;
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "规则";
  const sk = url.searchParams.get("similarity_top_k");
  const rn = url.searchParams.get("rerank_top_n");

  const sp = new URLSearchParams();
  sp.set("q", q);
  if (sk != null && sk.trim() !== "") {
    const n = Number.parseInt(sk, 10);
    if (Number.isFinite(n) && n >= 1) sp.set("similarity_top_k", String(n));
  }
  if (rn != null && rn.trim() !== "") {
    const n = Number.parseInt(rn, 10);
    if (Number.isFinite(n) && n >= 1) sp.set("rerank_top_n", String(n));
  }

  try {
    const base = getRuleEngineBaseUrl();
    const ai = await ruleEngineAiHeaders({ gameId });
    const res = await fetch(
      `${base}/index/${encodeURIComponent(gameId)}/smoke-retrieve?${sp.toString()}`,
      {
        method: "GET",
        headers: ai,
        cache: "no-store",
      },
    );
    const text = await res.text();
    if (!res.ok) {
      let message = text || `规则引擎返回 ${res.status}`;
      try {
        const j = JSON.parse(text) as { detail?: unknown; message?: string };
        if (typeof j.detail === "string") message = j.detail;
        else if (j.detail != null) message = JSON.stringify(j.detail);
        else if (typeof j.message === "string") message = j.message;
      } catch {
        /* keep raw */
      }
      return NextResponse.json({ message }, { status: res.status });
    }
    return NextResponse.json(JSON.parse(text) as unknown);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
