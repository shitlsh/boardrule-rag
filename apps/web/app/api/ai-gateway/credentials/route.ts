import { NextResponse } from "next/server";

import { addCredential } from "@/lib/ai-gateway";
import type { AiVendor } from "@/lib/ai-gateway-types";
import { isAiVendor } from "@/lib/ai-gateway-types";
import { assertAdminSession } from "@/lib/request-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
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
  const o = body as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const alias = typeof o.alias === "string" ? o.alias : "";
  const apiKey = typeof o.apiKey === "string" ? o.apiKey : "";
  if (!id) {
    return NextResponse.json({ message: "id 必填" }, { status: 400 });
  }

  let vendor: AiVendor = "gemini";
  if (o.vendor !== undefined) {
    if (typeof o.vendor !== "string" || !isAiVendor(o.vendor)) {
      return NextResponse.json(
        { message: "vendor 必须为 gemini、openrouter、qwen 或 bedrock" },
        { status: 400 },
      );
    }
    vendor = o.vendor;
  }
  const dashscopeCompatibleBase =
    typeof o.dashscopeCompatibleBase === "string" ? o.dashscopeCompatibleBase : undefined;
  const bedrockRegion = typeof o.bedrockRegion === "string" ? o.bedrockRegion : undefined;
  const bedrockAuthMode =
    o.bedrockAuthMode === "iam" || o.bedrockAuthMode === "api_key" ? o.bedrockAuthMode : undefined;
  const bedrockAccessKeyId =
    typeof o.bedrockAccessKeyId === "string" ? o.bedrockAccessKeyId : undefined;
  const bedrockSecretAccessKey =
    typeof o.bedrockSecretAccessKey === "string" ? o.bedrockSecretAccessKey : undefined;
  const bedrockSessionToken =
    typeof o.bedrockSessionToken === "string" ? o.bedrockSessionToken : undefined;

  try {
    const data = await addCredential({
      id,
      alias,
      apiKey,
      vendor,
      ...(vendor === "qwen" ? { dashscopeCompatibleBase } : {}),
      ...(vendor === "bedrock"
        ? {
            bedrockRegion,
            bedrockAuthMode,
            bedrockAccessKeyId,
            bedrockSecretAccessKey,
            bedrockSessionToken,
          }
        : {}),
    });
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    const status = /为空|已存在|冲突|不存在/.test(msg) ? 400 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}
