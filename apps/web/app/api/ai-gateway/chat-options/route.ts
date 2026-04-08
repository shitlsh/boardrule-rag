import { NextResponse } from "next/server";

import { patchGatewayChatOptions } from "@/lib/ai-gateway";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ message: "Expected object body" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const patch: { temperature?: number; maxTokens?: number } = {};
  if (o.temperature !== undefined) {
    patch.temperature = typeof o.temperature === "number" ? o.temperature : Number(o.temperature);
  }
  if (o.maxTokens !== undefined) {
    patch.maxTokens = typeof o.maxTokens === "number" ? o.maxTokens : Number(o.maxTokens);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ message: "无有效字段" }, { status: 400 });
  }
  try {
    const data = await patchGatewayChatOptions(patch);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    const status = /无效/.test(msg) ? 400 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}
