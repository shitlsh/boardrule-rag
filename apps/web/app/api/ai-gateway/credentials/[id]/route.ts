import { NextResponse } from "next/server";

import { removeCredentialById, updateCredential } from "@/lib/ai-gateway";
import type { AiVendor } from "@/lib/ai-gateway-types";
import { isAiVendor } from "@/lib/ai-gateway-types";
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
  const vendorRaw = o.vendor !== undefined ? o.vendor : undefined;
  const vendor: AiVendor | undefined =
    typeof vendorRaw === "string" && isAiVendor(vendorRaw) ? vendorRaw : undefined;
  const dashscopeCompatibleBase =
    o.dashscopeCompatibleBase !== undefined
      ? typeof o.dashscopeCompatibleBase === "string"
        ? o.dashscopeCompatibleBase
        : undefined
      : undefined;
  const bedrockRegion =
    o.bedrockRegion !== undefined
      ? typeof o.bedrockRegion === "string"
        ? o.bedrockRegion
        : undefined
      : undefined;
  const bedrockAuthMode =
    o.bedrockAuthMode === "iam" || o.bedrockAuthMode === "api_key" ? o.bedrockAuthMode : undefined;
  const bedrockAccessKeyId =
    o.bedrockAccessKeyId !== undefined
      ? typeof o.bedrockAccessKeyId === "string"
        ? o.bedrockAccessKeyId
        : undefined
      : undefined;
  const bedrockSecretAccessKey =
    o.bedrockSecretAccessKey !== undefined
      ? typeof o.bedrockSecretAccessKey === "string"
        ? o.bedrockSecretAccessKey
        : undefined
      : undefined;
  const bedrockSessionToken =
    o.bedrockSessionToken !== undefined
      ? typeof o.bedrockSessionToken === "string"
        ? o.bedrockSessionToken
        : undefined
      : undefined;

  const enabled =
    o.enabled !== undefined ? (typeof o.enabled === "boolean" ? o.enabled : undefined) : undefined;
  if (o.enabled !== undefined && enabled === undefined) {
    return NextResponse.json({ message: "enabled 须为布尔值" }, { status: 400 });
  }

  let hiddenModelIds: string[] | undefined;
  if (o.hiddenModelIds !== undefined) {
    if (!Array.isArray(o.hiddenModelIds)) {
      return NextResponse.json({ message: "hiddenModelIds 须为字符串数组" }, { status: 400 });
    }
    hiddenModelIds = o.hiddenModelIds.filter((x): x is string => typeof x === "string");
  }

  try {
    const data = await updateCredential({
      id: id.trim(),
      ...(alias !== undefined ? { alias } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(vendor !== undefined ? { vendor } : {}),
      ...(dashscopeCompatibleBase !== undefined ? { dashscopeCompatibleBase } : {}),
      ...(bedrockRegion !== undefined ? { bedrockRegion } : {}),
      ...(bedrockAuthMode !== undefined ? { bedrockAuthMode } : {}),
      ...(bedrockAccessKeyId !== undefined ? { bedrockAccessKeyId } : {}),
      ...(bedrockSecretAccessKey !== undefined ? { bedrockSecretAccessKey } : {}),
      ...(bedrockSessionToken !== undefined ? { bedrockSessionToken } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(hiddenModelIds !== undefined ? { hiddenModelIds } : {}),
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
