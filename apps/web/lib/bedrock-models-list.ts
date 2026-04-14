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

function normalizeSummaries(rows: BedrockModelSummary[]): GeminiModelOption[] {
  const out: GeminiModelOption[] = [];
  for (const m of rows) {
    const p = parseOne(m);
    if (p) out.push(p);
  }
  return out;
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
