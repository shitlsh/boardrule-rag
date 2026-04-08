import { NextResponse } from "next/server";

import { getCredentialApiKey, getAiGatewayStored, setSlotBinding } from "@/lib/ai-gateway";
import type { SlotKey } from "@/lib/ai-gateway-types";
import { fetchGeminiModelsForSlot } from "@/lib/gemini-models-list";

export const runtime = "nodejs";

const ALLOWED = new Set<SlotKey>(["flash", "pro", "embed", "chat"]);

type RouteParams = { params: Promise<{ slot: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
  const { slot: raw } = await params;
  const slot = raw?.trim() as SlotKey;
  if (!raw || !ALLOWED.has(slot)) {
    return NextResponse.json({ message: "无效槽位" }, { status: 400 });
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

  const clear = o.clear === true;
  if (clear) {
    try {
      const data = await setSlotBinding(slot, null);
      return NextResponse.json(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失败";
      return NextResponse.json({ message: msg }, { status: 500 });
    }
  }

  const credentialId = typeof o.credentialId === "string" ? o.credentialId.trim() : "";
  const model = typeof o.model === "string" ? o.model.trim() : "";
  if (!credentialId || !model) {
    return NextResponse.json({ message: "credentialId 与 model 必填" }, { status: 400 });
  }

  try {
    const stored = await getAiGatewayStored();
    const apiKey = getCredentialApiKey(stored, credentialId);
    const allowed = await fetchGeminiModelsForSlot(apiKey, slot);
    if (!allowed.some((m) => m.name === model)) {
      return NextResponse.json(
        { message: "模型必须是当前槽位下 Google 返回的可用模型，请从列表中选择后保存" },
        { status: 400 },
      );
    }
    const data = await setSlotBinding(slot, { credentialId, model });
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "保存失败";
    const status = /不存在|请选择|无效/.test(msg) ? 400 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}
