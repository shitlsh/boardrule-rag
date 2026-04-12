import { NextResponse } from "next/server";

import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";
import { assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

/**
 * Proxies `GET /graph/extraction-mermaid` on the rule engine (staff only).
 */
export async function GET() {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const base = getRuleEngineBaseUrl();
  const key = process.env.RULE_ENGINE_API_KEY?.trim();
  const headers: Record<string, string> = {};
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  let res: Response;
  try {
    res = await fetch(`${base}/graph/extraction-mermaid`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ message: `无法连接规则引擎: ${msg}` }, { status: 502 });
  }

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ message: text || `规则引擎返回 ${res.status}` }, { status: 502 });
  }

  const data = (await res.json()) as { mermaid?: string };
  return NextResponse.json({ mermaid: data.mermaid ?? "" });
}
