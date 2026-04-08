import { NextResponse } from "next/server";

import type { SlotKey } from "@/lib/ai-gateway-types";
import { fetchGeminiModelsForSlot, fetchGeminiModelsFromGoogle } from "@/lib/gemini-models-list";
import { getAiGatewayStored, getCredentialApiKey } from "@/lib/ai-gateway";

export const runtime = "nodejs";

const SLOT_KEYS: readonly SlotKey[] = ["flash", "pro", "embed", "chat"];

function parseSlot(raw: unknown): SlotKey | null | "invalid" {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const s = raw.trim() as SlotKey;
  return SLOT_KEYS.includes(s) ? s : "invalid";
}

/**
 * List Gemini models (normalized + optional slot filter).
 * - GET ?credentialId=…&slot=flash|pro|embed|chat — slot optional; when set, filters by capability.
 * - POST JSON { credentialId } or { apiKey }, optional slot — same behavior.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const credentialId = searchParams.get("credentialId")?.trim();
  if (!credentialId) {
    return NextResponse.json({ message: "credentialId 必填" }, { status: 400 });
  }

  const slot = parseSlot(searchParams.get("slot"));
  if (slot === "invalid") {
    return NextResponse.json({ message: "slot 无效（flash | pro | embed | chat）" }, { status: 400 });
  }

  let apiKey: string;
  try {
    const stored = await getAiGatewayStored();
    apiKey = getCredentialApiKey(stored, credentialId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取凭证失败";
    return NextResponse.json({ message: msg }, { status: 400 });
  }

  try {
    const models = slot
      ? await fetchGeminiModelsForSlot(apiKey, slot)
      : await fetchGeminiModelsFromGoogle(apiKey);
    return NextResponse.json({ models, slot: slot ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "拉取模型列表失败";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}

export async function POST(req: Request) {
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
  const apiKeyDirect = typeof o.apiKey === "string" ? o.apiKey.trim() : "";
  const credentialId = typeof o.credentialId === "string" ? o.credentialId.trim() : "";
  const slot = parseSlot(o.slot);

  if (slot === "invalid") {
    return NextResponse.json({ message: "slot 无效（flash | pro | embed | chat）" }, { status: 400 });
  }

  let apiKey: string;
  if (apiKeyDirect) {
    apiKey = apiKeyDirect;
  } else if (credentialId) {
    try {
      const stored = await getAiGatewayStored();
      apiKey = getCredentialApiKey(stored, credentialId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "读取凭证失败";
      return NextResponse.json({ message: msg }, { status: 400 });
    }
  } else {
    return NextResponse.json({ message: "请提供 apiKey 或 credentialId" }, { status: 400 });
  }

  try {
    const models = slot
      ? await fetchGeminiModelsForSlot(apiKey, slot)
      : await fetchGeminiModelsFromGoogle(apiKey);
    return NextResponse.json({ models, slot: slot ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "拉取模型列表失败";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
