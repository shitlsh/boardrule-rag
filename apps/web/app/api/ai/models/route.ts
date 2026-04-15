import { NextResponse } from "next/server";

import type { AiVendor, SlotKey } from "@/lib/ai-gateway-types";
import { getAiGatewayStored, getCredentialVendor } from "@/lib/ai-gateway";
import { fetchClaudeModelsForSlot, fetchClaudeModelsFromApi } from "@/lib/claude-models-list";
import { fetchGeminiModelsForSlot, fetchGeminiModelsFromGoogle } from "@/lib/gemini-models-list";
import { fetchModelsForCredential } from "@/lib/models-for-credential";
import {
  fetchOpenRouterModelsForSlot,
  fetchOpenRouterModelsFromApi,
} from "@/lib/openrouter-models-list";
import { normalizeDashscopeCompatibleBase } from "@/lib/dashscope-endpoint";
import { fetchQwenModelsForSlot, fetchQwenModelsFromApi } from "@/lib/qwen-models-list";
import {
  fetchBedrockFoundationModels,
  filterBedrockModelsForSlot,
} from "@/lib/bedrock-models-list";
import { listJinaModelsForSlot } from "@/lib/jina-models-list";
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
  if (
    raw === "gemini" ||
    raw === "openrouter" ||
    raw === "qwen" ||
    raw === "bedrock" ||
    raw === "claude" ||
    raw === "jina"
  ) {
    return raw;
  }
  return "invalid";
}

async function listModelsByKey(
  vendor: AiVendor,
  apiKey: string,
  slot: SlotKey | null,
  /** Only used when vendor is qwen (preview before saving credential). */
  qwenCompatibleBase?: string,
): Promise<unknown[]> {
  if (vendor === "openrouter") {
    return slot
      ? await fetchOpenRouterModelsForSlot(apiKey, slot)
      : await fetchOpenRouterModelsFromApi(apiKey);
  }
  if (vendor === "qwen") {
    const base = normalizeDashscopeCompatibleBase(qwenCompatibleBase);
    return slot
      ? await fetchQwenModelsForSlot(apiKey, slot, base)
      : await fetchQwenModelsFromApi(apiKey, base);
  }
  if (vendor === "claude") {
    return slot
      ? await fetchClaudeModelsForSlot(apiKey, slot)
      : await fetchClaudeModelsFromApi(apiKey);
  }
  if (vendor === "jina") {
    if (slot === "embed") return listJinaModelsForSlot("embed");
    if (slot === "rerank") return listJinaModelsForSlot("rerank");
    return [...listJinaModelsForSlot("embed"), ...listJinaModelsForSlot("rerank")];
  }
  return slot ? await fetchGeminiModelsForSlot(apiKey, slot) : await fetchGeminiModelsFromGoogle(apiKey);
}

async function listBedrockModelsFromBody(
  o: Record<string, unknown>,
  slot: SlotKey | null,
): Promise<unknown[]> {
  const region = typeof o.bedrockRegion === "string" ? o.bedrockRegion.trim() : "";
  const mode = o.bedrockAuthMode === "iam" || o.bedrockAuthMode === "api_key" ? o.bedrockAuthMode : null;
  if (!region || !mode) {
    throw new Error("Bedrock 预览需要 bedrockRegion 与 bedrockAuthMode（iam | api_key）");
  }
  let models: Awaited<ReturnType<typeof fetchBedrockFoundationModels>>;
  if (mode === "api_key") {
    const token = typeof o.apiKey === "string" ? o.apiKey.trim() : "";
    if (!token) throw new Error("Bedrock API Key 不能为空");
    models = await fetchBedrockFoundationModels({
      authMode: "api_key",
      region,
      bearerToken: token,
    });
  } else {
    const accessKeyId = typeof o.bedrockAccessKeyId === "string" ? o.bedrockAccessKeyId.trim() : "";
    const secretAccessKey =
      typeof o.bedrockSecretAccessKey === "string" ? o.bedrockSecretAccessKey.trim() : "";
    const sessionToken =
      typeof o.bedrockSessionToken === "string" && o.bedrockSessionToken.trim() !== ""
        ? o.bedrockSessionToken.trim()
        : undefined;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Bedrock IAM 预览需要 bedrockAccessKeyId 与 bedrockSecretAccessKey");
    }
    models = await fetchBedrockFoundationModels({
      authMode: "iam",
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });
  }
  return slot ? filterBedrockModelsForSlot(models, slot) : models;
}

/**
 * List models for a credential (Gemini, OpenRouter, Qwen, or Bedrock) with optional slot filter.
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
    return NextResponse.json({ message: "slot 无效（flash | pro | embed | chat | rerank）" }, { status: 400 });
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
  const qwenBaseRaw = typeof o.dashscopeCompatibleBase === "string" ? o.dashscopeCompatibleBase : "";
  const slot = parseSlot(o.slot);

  if (slot === "invalid") {
    return NextResponse.json({ message: "slot 无效（flash | pro | embed | chat | rerank）" }, { status: 400 });
  }

  let vendor: AiVendor;
  let apiKey: string;
  const vendorPreview = parseVendor(o.vendor);
  const bedrockPreview =
    vendorPreview === "bedrock" &&
    typeof o.bedrockRegion === "string" &&
    o.bedrockRegion.trim() !== "";

  if (apiKeyDirect || bedrockPreview) {
    const v = vendorPreview;
    if (v === "invalid") {
      return NextResponse.json(
        { message: "使用 apiKey 时须同时提供 vendor: gemini | openrouter | qwen | bedrock | claude | jina" },
        { status: 400 },
      );
    }
    vendor = v;
    apiKey = apiKeyDirect;
    if (vendor === "bedrock") {
      try {
        const models = await listBedrockModelsFromBody(o, slot);
        return NextResponse.json({ models, slot: slot ?? null, vendor });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "拉取模型列表失败";
        return NextResponse.json({ message: msg }, { status: 400 });
      }
    }
  } else if (credentialId) {
    try {
      const stored = await getAiGatewayStored();
      const includeHidden = o.includeHidden === true;
      if (includeHidden && slot !== null) {
        return NextResponse.json(
          { message: "includeHidden 仅可与全量列表（不传 slot）同时使用" },
          { status: 400 },
        );
      }
      const models = await fetchModelsForCredential(stored, credentialId, slot, { includeHidden });
      const v = getCredentialVendor(stored, credentialId);
      return NextResponse.json({ models, slot: slot ?? null, vendor: v });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "拉取模型列表失败";
      const status = /凭证|不存在/.test(msg) ? 400 : 502;
      return NextResponse.json({ message: msg }, { status });
    }
  } else {
    return NextResponse.json({ message: "请提供 apiKey+vendor 或 credentialId" }, { status: 400 });
  }

  try {
    const models = await listModelsByKey(vendor, apiKey, slot, qwenBaseRaw || undefined);
    return NextResponse.json({ models, slot: slot ?? null, vendor });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "拉取模型列表失败";
    return NextResponse.json({ message: msg }, { status: 502 });
  }
}
