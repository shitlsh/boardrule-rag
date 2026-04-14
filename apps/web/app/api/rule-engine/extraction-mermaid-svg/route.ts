import { NextResponse } from "next/server";

import { fetchExtractionMermaidFromRuleEngine } from "@/lib/rule-engine-extraction-mermaid-fetch";
import { assertStaffSession } from "@/lib/request-auth";
import { renderExtractionMermaidToSvg } from "@/lib/server/render-extraction-mermaid-svg";

export const runtime = "nodejs";

/**
 * Staff-only: returns rendered SVG for the extraction pipeline (same graph as `/graph/extraction-mermaid`).
 * Renders on the server (happy-dom + mermaid) so the page does not depend on client-side Mermaid/DOM quirks.
 */
export async function GET() {
  const denied = await assertStaffSession();
  if (denied) return denied;

  let mermaidText: string;
  try {
    mermaidText = await fetchExtractionMermaidFromRuleEngine();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ message: msg }, { status: 502 });
  }

  try {
    const svg = await renderExtractionMermaidToSvg(mermaidText);
    return new NextResponse(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ message: `流程图渲染失败: ${msg}` }, { status: 500 });
  }
}
