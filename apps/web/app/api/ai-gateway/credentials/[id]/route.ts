import { NextResponse } from "next/server";

import { removeCredentialById, updateGeminiCredential } from "@/lib/ai-gateway";
import { assertAdminSession } from "@/lib/request-auth";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
  const denied = await assertAdminSession();
  if (denied) return denied;

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ message: "无效 id" }, { status: 400 });
  }

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
  const alias = o.alias !== undefined ? (typeof o.alias === "string" ? o.alias : undefined) : undefined;
  const apiKey = o.apiKey !== undefined ? (typeof o.apiKey === "string" ? o.apiKey : undefined) : undefined;

  try {
    const data = await updateGeminiCredential({
      id: id.trim(),
      ...(alias !== undefined ? { alias } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
    });
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    const status = /为空|已存在|不存在/.test(msg) ? 400 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const denied = await assertAdminSession();
  if (denied) return denied;

  const { id } = await params;
  if (!id?.trim()) {
    return NextResponse.json({ message: "无效 id" }, { status: 400 });
  }
  try {
    const data = await removeCredentialById(id.trim());
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "删除失败";
    const status = /不存在/.test(msg) ? 400 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}
