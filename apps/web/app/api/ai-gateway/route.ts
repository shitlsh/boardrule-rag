import { NextResponse } from "next/server";

import {
  getAiGatewayPublic,
  updateAiGatewayFromPatch,
  type AiGatewayPatchBody,
} from "@/lib/ai-gateway";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await getAiGatewayPublic();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取 AI Gateway 失败";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}

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

  try {
    const data = await updateAiGatewayFromPatch(body as AiGatewayPatchBody);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    const status = /必须|无效|不存在|冲突|未配置/.test(msg) ? 400 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}
