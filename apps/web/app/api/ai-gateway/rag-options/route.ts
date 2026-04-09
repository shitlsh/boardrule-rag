import { NextResponse } from "next/server";

import { patchGatewayRagOptions, type RagOptionsPatch } from "@/lib/ai-gateway";
import { assertAdminSession } from "@/lib/request-auth";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const denied = await assertAdminSession();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ message: "Expected object body" }, { status: 400 });
  }
  try {
    const data = await patchGatewayRagOptions(body as RagOptionsPatch);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    const status = /无效/.test(msg) ? 400 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}
