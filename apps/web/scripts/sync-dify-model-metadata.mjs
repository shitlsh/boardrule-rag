/**
 * Fetches Dify official-plugin YAMLs (tongyi, gemini, openrouter: llm + text_embedding)
 * and writes lib/data/dify-model-metadata.json for runtime model metadata enrichment.
 *
 * https://github.com/langgenius/dify-official-plugins
 *
 * Usage (from apps/web): npm run sync:dify-model-metadata
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../lib/data/dify-model-metadata.json");

const API_ROOT = "https://api.github.com/repos/langgenius/dify-official-plugins/contents";

const PLUGINS = [
  { vendor: "qwen", base: "models/tongyi/models" },
  { vendor: "gemini", base: "models/gemini/models" },
  { vendor: "openrouter", base: "models/openrouter/models" },
];

const SUBDIRS = ["llm", "text_embedding"];

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "boardrule-rag-sync-dify-model-metadata",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  return res.text();
}

/** @param {unknown} doc */
function extractEntry(doc, category) {
  if (!doc || typeof doc !== "object") return null;
  const o = doc;
  const model = typeof o.model === "string" ? o.model.trim() : "";
  if (!model) return null;

  const mp = o.model_properties && typeof o.model_properties === "object" ? o.model_properties : {};
  let mode =
    typeof mp.mode === "string" && mp.mode.trim() !== "" ? mp.mode.trim() : undefined;
  if (!mode && o.model_type === "text-embedding") {
    mode = "embedding";
  }

  let contextSize;
  const cs = mp.context_size;
  if (typeof cs === "number" && Number.isFinite(cs)) {
    contextSize = cs;
  } else if (typeof cs === "string" && cs.trim() !== "") {
    const n = Number(cs);
    if (Number.isFinite(n)) contextSize = n;
  }

  const features = Array.isArray(o.features) ? o.features.filter((x) => typeof x === "string") : [];
  const supportsVision = features.some((f) => f === "vision" || f === "video");

  const modelType = typeof o.model_type === "string" ? o.model_type : "";

  let maxOutputTokens;
  const rules = Array.isArray(o.parameter_rules) ? o.parameter_rules : [];
  for (const r of rules) {
    if (!r || typeof r !== "object") continue;
    const name = typeof r.name === "string" ? r.name : "";
    if (name !== "max_tokens" && name !== "max_output_tokens") continue;
    const mx = r.max;
    if (typeof mx === "number" && Number.isFinite(mx) && mx > 0) {
      maxOutputTokens = Math.trunc(mx);
      break;
    }
  }

  return {
    model,
    category,
    modelType,
    ...(mode ? { mode } : {}),
    ...(contextSize !== undefined && contextSize > 0 ? { contextSize } : {}),
    supportsVision,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(features.length > 0 ? { features } : {}),
  };
}

/**
 * @param {string} contentPath e.g. models/gemini/models/llm
 */
async function collectFromDir(contentPath) {
  const parts = contentPath.split("/");
  const subdir = parts[parts.length - 1] ?? "";
  const category = subdir === "llm" ? "llm" : subdir === "text_embedding" ? "text_embedding" : subdir;
  const url = `${API_ROOT}/${contentPath}?ref=main`;
  /** @type {{ name: string; type: string; download_url: string | null }[]} */
  const listing = await fetchJson(url);
  const out = [];
  for (const item of listing) {
    if (item.type !== "file" || !item.name.endsWith(".yaml")) continue;
    if (item.name.startsWith("_")) continue;
    if (!item.download_url) continue;
    const text = await fetchText(item.download_url);
    let doc;
    try {
      doc = YAML.parse(text);
    } catch {
      console.warn(`skip parse: ${contentPath}/${item.name}`);
      continue;
    }
    const entry = extractEntry(doc, category);
    if (entry) out.push(entry);
  }
  return out;
}

async function main() {
  /** @type {Record<string, Record<string, object>>} */
  const byVendor = { qwen: {}, gemini: {}, openrouter: {} };

  for (const { vendor, base } of PLUGINS) {
    const merged = [];
    for (const sub of SUBDIRS) {
      const path = `${base}/${sub}`;
      process.stderr.write(`Fetching ${path}...\n`);
      merged.push(...(await collectFromDir(path)));
    }
    const bucket = byVendor[vendor];
    for (const e of merged) {
      const id = e.model;
      if (bucket[id]) {
        console.warn(`[${vendor}] duplicate model key, keeping first: ${id}`);
        continue;
      }
      bucket[id] = e;
    }
    console.log(`[${vendor}] ${Object.keys(bucket).length} models`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(byVendor, null, 0)}\n`, "utf8");
  console.log(`Wrote -> ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
