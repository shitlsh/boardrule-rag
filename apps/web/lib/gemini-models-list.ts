/** Server-only: fetch & normalize Gemini models from Google Generative Language API. */

import type { SlotKey } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

type GoogleModel = {
  name?: string;
  displayName?: string;
  display_name?: string;
  description?: string;
  inputTokenLimit?: string | number;
  input_token_limit?: string | number;
  outputTokenLimit?: string | number;
  output_token_limit?: string | number;
  supportedGenerationMethods?: string[];
  supported_generation_methods?: string[];
};

type GoogleListModelsResponse = {
  models?: GoogleModel[];
};

function parseInt64(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Google list_models 往往不会在 description 里写「multimodal」；这里结合文案与命名做启发式。
 * 近期 Gemini Pro / Flash 主线默认具备多模态；纯嵌入/文本向量化等单独排除。
 */
function inferVisionHint(name: string, description: string, canGen: boolean): boolean {
  if (!canGen) return false;
  const id = name.toLowerCase();
  const t = `${name} ${description}`.toLowerCase();
  if (/\b(multimodal|multi-modal|image|images|vision|pixel|audio|video|graphical)\b/.test(t)) {
    return true;
  }
  if (!/gemini/i.test(id) && !/gemini/i.test(description)) {
    return false;
  }
  if (/\b(embed|embedding|text-embedding|gecko|aqa|rag|text\s*bison)\b/.test(t)) {
    return false;
  }
  // 命名/展示名里带 Pro、Flash、Ultra 的 Gemini 生成模型，按多模态展示（含 *-preview、3.1 等）
  if (/\b(pro|flash|ultra)\b/i.test(name) || /\b(pro|flash|ultra)\b/i.test(description)) {
    return true;
  }
  return false;
}

function isLikelyDeprecated(m: GoogleModel): boolean {
  const n = (m.name ?? "").toLowerCase();
  const d = (m.description ?? "").toLowerCase();
  return /\bdeprecated\b/.test(n) || /\bdeprecated\b/.test(d) || /\blegacy\b/.test(n);
}

function parseOne(m: GoogleModel): GeminiModelOption | null {
  const name = typeof m.name === "string" ? m.name.trim() : "";
  if (!name) return null;
  const rawMethods = m.supportedGenerationMethods ?? m.supported_generation_methods ?? [];
  const methods = rawMethods.map((x) => String(x));
  const canGen = methods.some((x) => /generateContent|GENERATE_CONTENT/i.test(x));
  const canEmbed = methods.some((x) => /embedContent|EMBED_CONTENT/i.test(x));
  const description = typeof m.description === "string" ? m.description : "";
  const dn =
    typeof m.displayName === "string" && m.displayName.trim() !== ""
      ? m.displayName.trim()
      : typeof m.display_name === "string" && m.display_name.trim() !== ""
        ? m.display_name.trim()
        : "";
  const displayName = dn || name;
  return {
    name,
    displayName,
    description,
    inputTokenLimit: parseInt64(m.inputTokenLimit ?? m.input_token_limit),
    outputTokenLimit: parseInt64(m.outputTokenLimit ?? m.output_token_limit),
    capabilities: { generateContent: canGen, embedContent: canEmbed },
    visionHint: inferVisionHint(name, description, canGen),
  };
}

/** Drop deprecated / empty; keep anything that has at least one capability we care about. */
function parseAllRaw(data: GoogleListModelsResponse): GeminiModelOption[] {
  const raw = data.models ?? [];
  const out: GeminiModelOption[] = [];
  for (const m of raw) {
    if (isLikelyDeprecated(m)) continue;
    const p = parseOne(m);
    if (!p) continue;
    if (!p.capabilities.generateContent && !p.capabilities.embedContent) continue;
    out.push(p);
  }
  return out;
}

function isEmbedOnly(m: GeminiModelOption): boolean {
  return m.capabilities.embedContent && !m.capabilities.generateContent;
}

/**
 * Filter by configured slot: embed → embed-capable only; flash/pro/chat → generation, exclude embed-only.
 */
export function filterModelsForSlot(models: GeminiModelOption[], slot: SlotKey): GeminiModelOption[] {
  switch (slot) {
    case "embed":
      return models.filter((m) => m.capabilities.embedContent);
    case "flash":
    case "pro":
    case "chat":
      return models.filter((m) => m.capabilities.generateContent && !isEmbedOnly(m));
    default:
      return models;
  }
}

export async function fetchGeminiModelsFromGoogle(apiKey: string): Promise<GeminiModelOption[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`;
  const res = await fetch(url, { method: "GET", next: { revalidate: 0 } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Google API error: ${res.status}`);
  }
  const data = JSON.parse(text) as GoogleListModelsResponse;
  return parseAllRaw(data);
}

export async function fetchGeminiModelsForSlot(
  apiKey: string,
  slot: SlotKey,
): Promise<GeminiModelOption[]> {
  const all = await fetchGeminiModelsFromGoogle(apiKey);
  return filterModelsForSlot(all, slot);
}
