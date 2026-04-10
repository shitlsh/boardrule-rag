import { NextResponse } from "next/server";

import type { AiVendor, SlotKey } from "@/lib/ai-gateway-types";
import { getAiGatewayStored, getCredentialApiKey, getCredentialVendor } from "@/lib/ai-gateway";
import { fetchGeminiModelsForSlot, fetchGeminiModelsFromGoogle } from "@/lib/gemini-models-list";
import { fetchModelsForCredential } from "@/lib/models-for-credential";
import {
  fetchOpenRouterModelsForSlot,
  fetchOpenRouterModelsFromApi,
} from "@/lib/openrouter-models-list";
import { assertStaffSession } from "@/lib/request-auth";

export const runtime = "nodejs";

const SLOT_KEYS: readonly SlotKey[] = ["flash", "pro", "embed", "chat"];

function parseSlot(raw: unknown): SlotKey | null | "invalid" {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const s = raw.trim() as SlotKey;
  return SLOT_KEYS.includes(s) ? s : "invalid";
}

function parseVendor(raw: unknown): AiVendor | "invalid" {
  if (raw === "gemini" || raw === "openrouter") return raw;
  return "invalid";
}

async function listModelsByKey(
  vendor: AiVendor,
  apiKey: string,
  slot: SlotKey | null,
): Promise<unknown[]> {
  if (vendor === "openrouter") {
    return slot
      ? await fetchOpenRouterModelsForSlot(apiKey, slot)
      : await fetchOpenRouterModelsFromApi(apiKey);
  }
  return slot ? await fetchGeminiModelsForSlot(apiKey, slot) : await fetchGeminiModelsFromGoogle(apiKey);
}

/**
 * List models for a credential (Gemini or OpenRouter) with optional slot filter.
 * - GET ?credentialId=…&slot=flash|pro|embed|chat — slot optional; when set, filters by capability.
 * - POST JSON { credentialId } or { apiKey, vendor }, optional slot — same behavior.
 */
export async function GET(req: Request) {
  const denied = await assertStaffSession();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const credentialId = searchParams.get("credentialId")?.trim();
  if (!credentialId) {
    return NextResponse.json({ message: "credentialId 必填" }, { status: 400 });
  }

  const slot = parseSlot(searchParams.get("slot"));
  if (slot === "invalid") {
    return NextResponse.json({ message: "slot 无效（flash | pro | embed | chat）" }, { status: 400 });
  }

  try {
    const stored = await getAiGatewayStored();
    const vendor = getCredentialVendor(stored, credentialId);
    const models = await fetchModelsForCredential(stored, credentialId, slot);
    return NextResponse.json({ models, slot: slot ?? null, vendor });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取凭证失败或拉取模型列表失败";
    const status = /凭证|不存在/.test(msg) ? 400 : 502;
    return NextResponse.json({ message: msg }, { status });
  }
}

export async function POST(req: Request) {
  const denied = await assertStaffSession();
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
  const apiKeyDirect = typeof o.apiKey === "string" ? o.apiKey.trim() : "";
  const credentialId = typeof o.credentialId === "string" ? o.credentialId.trim() : "";
  const slot = parseSlot(o.slot);

  if (slot === "invalid") {
    return NextResponse.json({ message: "slot 无效（flash | pro | embed | chat）" }, { status: 400 });
  }

  let vendor: AiVendor;
  let apiKey: string;
  if (apiKeyDirect) {
    const v = parseVendor(o.vendor);
    if (v === "invalid") {
      return NextResponse.json(
        { message: "使用 apiKey 时须同时提供 vendor: gemini | openrouter" },
        { status: 400 },
      );
    }
    vendor = v;
    apiKey = apiKeyDirect;
  } else if (credentialId) {
    try {
      const stored = await getAiGatewayStored();
      vendor = getCredentialVendor(stored, credentialId);
      apiKey = getCredentialApiKey(stored, credentialId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "读取凭证失败";
      return NextResponse.json({ message: msg }, { status: 400 });
    }
  } else {
    return NextResponse.json({ message: "请提供 apiKey+vendor 或 credentialId" }, { status: 400 });
  }

  try {
    const models = await listModelsByKey(vendor, apiKey, slot);
    return NextResponse.json({ models, slot: slot ?? null, vendor });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "拉取模型列表失败";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
