/** Server-only: list Bedrock foundation models for the model picker (same shape as Gemini options). */

import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import { decryptSecret } from "@/lib/ai-crypto";
import type { AiGatewayStored, SlotKey } from "@/lib/ai-gateway-types";
import { getStoredCredential } from "@/lib/ai-gateway";
import {
  assertBedrockCredentialComplete,
  isBedrockIamPayload,
  parseBedrockIamPayload,
} from "@/lib/bedrock-credential";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

/** Subset of AWS ListFoundationModels modelSummaries items. */
type BedrockModelSummary = {
  modelArn?: string;
  modelId?: string;
  modelName?: string;
  providerName?: string;
  inputModalities?: string[];
  outputModalities?: string[];
};

async function listSummariesIam(opts: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}): Promise<BedrockModelSummary[]> {
  const client = new BedrockClient({
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      sessionToken: opts.sessionToken,
    },
  });
  const out = await client.send(new ListFoundationModelsCommand({}));
  return out.modelSummaries ?? [];
}

/** Bedrock API keys: Bearer against control-plane ListFoundationModels (see AWS Bedrock user guide). */
async function listSummariesBearer(region: string, bearerToken: string): Promise<BedrockModelSummary[]> {
  const url = `https://bedrock.${region}.amazonaws.com/foundation-models`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken.trim()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Bedrock ListFoundationModels error: ${res.status}`);
  }
  const data = JSON.parse(text) as { modelSummaries?: BedrockModelSummary[] };
  return data.modelSummaries ?? [];
}

function hasTextOut(m: BedrockModelSummary): boolean {
  return (m.outputModalities ?? []).some((x) => x === "TEXT");
}

function hasEmbedOut(m: BedrockModelSummary): boolean {
  return (m.outputModalities ?? []).some((x) => x === "EMBEDDING");
}

/**
 * `ListFoundationModels` returns per-context variants (e.g. `amazon.nova-pro-v1:0:300k`).
 * `Converse` uses the base model ID (`amazon.nova-pro-v1:0`); suffixed IDs often return
 * `ResourceNotFoundException: Model not found`.
 */
export function canonicalBedrockConverseModelId(modelId: string): string {
  let t = modelId.trim();
  for (let i = 0; i < 4; i++) {
    const m = t.match(
      /^(.+):(\d+):(\d+k|mm|8k|20k|28k|48k|200k|256k|1000k|512|128k)$/i,
    );
    if (!m) break;
    t = `${m[1]}:${m[2]}`;
  }
  return t;
}

function parseOne(m: BedrockModelSummary): GeminiModelOption | null {
  const id = typeof m.modelId === "string" ? m.modelId.trim() : "";
  if (!id) return null;
  const displayName = (m.modelName ?? "").trim() || id;
  const provider = (m.providerName ?? "").trim();
  const description = provider ? `Bedrock · ${provider} · ${id}` : `Amazon Bedrock foundation model ${id}`;
  const embed = hasEmbedOut(m);
  const gen = hasTextOut(m);
  const vision =
    (m.inputModalities ?? []).some((x) => x === "IMAGE") ||
    /\b(claude-3|claude\.3|nova-pro|nova-lite|llama-3\.2-90b-vision|llama-3\.2-11b-vision)/i.test(
      id,
    );
  return {
    name: id,
    displayName,
    description,
    inputTokenLimit: null,
    outputTokenLimit: null,
    capabilities: {
      generateContent: gen,
      embedContent: embed,
    },
    visionHint: gen && vision,
  };
}

function finalizeBedrockRow(
  base: GeminiModelOption,
  canonical: string,
  variants: string[],
  modelNameRaw: string,
): GeminiModelOption {
  const baseName = (modelNameRaw ?? "").trim() || canonical;
  let displayName: string;
  if (variants.length > 1) {
    displayName = `${baseName} (${canonical})`;
  } else if (variants[0] !== canonical) {
    displayName = `${baseName} — ${canonical}`;
  } else {
    displayName = base.displayName;
  }
  let description = base.description;
  if (variants.length > 1) {
    description = `${description} · Converse 使用 ${canonical}（已合并 ${variants.length} 个列表 ID）`;
  } else if (variants[0] !== canonical) {
    description = `${description} · 列表 ID ${variants[0]} → Converse 使用 ${canonical}`;
  }
  return {
    ...base,
    name: canonical,
    displayName,
    description,
  };
}

function normalizeSummaries(rows: BedrockModelSummary[]): GeminiModelOption[] {
  const groups = new Map<
    string,
    { base: GeminiModelOption; variants: string[]; modelName: string }
  >();
  for (const m of rows) {
    const rawId = typeof m.modelId === "string" ? m.modelId.trim() : "";
    if (!rawId) continue;
    const canonical = canonicalBedrockConverseModelId(rawId);
    const p = parseOne(m);
    if (!p) continue;
    const modelName = (m.modelName ?? "").trim();
    const g = groups.get(canonical);
    if (!g) {
      groups.set(canonical, { base: p, variants: [rawId], modelName });
    } else {
      g.variants.push(rawId);
      g.base.capabilities.generateContent =
        g.base.capabilities.generateContent || p.capabilities.generateContent;
      g.base.capabilities.embedContent = g.base.capabilities.embedContent || p.capabilities.embedContent;
      g.base.visionHint = g.base.visionHint || p.visionHint;
      if (!g.modelName && modelName) g.modelName = modelName;
    }
  }
  const out: GeminiModelOption[] = [];
  for (const [canonical, { base, variants, modelName }] of groups.entries()) {
    out.push(finalizeBedrockRow(base, canonical, variants, modelName));
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.name.localeCompare(b.name));
}

export type BedrockListAuth =
  | {
      authMode: "iam";
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }
  | { authMode: "api_key"; region: string; bearerToken: string };

export async function fetchBedrockFoundationModels(auth: BedrockListAuth): Promise<GeminiModelOption[]> {
  const rows =
    auth.authMode === "iam"
      ? await listSummariesIam({
          region: auth.region,
          accessKeyId: auth.accessKeyId,
          secretAccessKey: auth.secretAccessKey,
          sessionToken: auth.sessionToken,
        })
      : await listSummariesBearer(auth.region, auth.bearerToken);
  return normalizeSummaries(rows);
}

function isEmbedOnlyOption(m: GeminiModelOption): boolean {
  return m.capabilities.embedContent && !m.capabilities.generateContent;
}

export function filterBedrockModelsForSlot(
  models: GeminiModelOption[],
  slot: SlotKey,
): GeminiModelOption[] {
  switch (slot) {
    case "embed":
      return models.filter((m) => m.capabilities.embedContent);
    case "flash":
    case "pro":
    case "chat":
      return models.filter((m) => m.capabilities.generateContent && !isEmbedOnlyOption(m));
    default:
      return models;
  }
}

export async function fetchBedrockModelsForSlot(
  auth: BedrockListAuth,
  slot: SlotKey,
): Promise<GeminiModelOption[]> {
  const all = await fetchBedrockFoundationModels(auth);
  return filterBedrockModelsForSlot(all, slot);
}

/** Resolve stored Bedrock credential and list models (IAM or API key). */
export async function fetchBedrockModelsForStoredCredential(
  stored: AiGatewayStored,
  credentialId: string,
  slot: SlotKey | null,
): Promise<GeminiModelOption[]> {
  const cred = getStoredCredential(stored, credentialId);
  if (!cred || cred.vendor !== "bedrock" || cred.enabled === false) {
    return [];
  }
  assertBedrockCredentialComplete(cred);
  const region = (cred.bedrockRegion ?? "").trim();
  const mode = cred.bedrockAuthMode!;
  const plain = decryptSecret(cred.apiKeyEnc);
  let auth: BedrockListAuth;
  if (mode === "api_key") {
    auth = { authMode: "api_key", region, bearerToken: plain.trim() };
  } else {
    if (!isBedrockIamPayload(plain)) {
      throw new Error("Bedrock IAM 凭证格式无效");
    }
    const iam = parseBedrockIamPayload(plain);
    auth = {
      authMode: "iam",
      region,
      accessKeyId: iam.accessKeyId,
      secretAccessKey: iam.secretAccessKey,
      sessionToken: iam.sessionToken,
    };
  }
  const all = await fetchBedrockFoundationModels(auth);
  const list = slot ? filterBedrockModelsForSlot(all, slot) : all;
  return list;
}
