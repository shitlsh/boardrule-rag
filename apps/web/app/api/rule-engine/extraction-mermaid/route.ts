import { NextResponse } from "next/server";

import { fetchExtractionMermaidFromRuleEngine } from "@/lib/rule-engine-extraction-mermaid-fetch";
import { assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

/**
 * Proxies `GET /graph/extraction-mermaid` on the rule engine (staff only).
 */
export async function GET() {
  const denied = await assertStaffSession();
  if (denied) return denied;

  try {
    const mermaid = await fetchExtractionMermaidFromRuleEngine();
    return NextResponse.json({ mermaid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
