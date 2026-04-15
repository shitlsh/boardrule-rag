/**
 * Fetches Dify official-plugin YAMLs and writes lib/data/dify-model-metadata.json
 * for runtime model metadata enrichment.
 *
 * https://github.com/langgenius/dify-official-plugins
 *
 * Usage (from apps/web):
 *   npm run sync:dify-model-metadata
 *   npm run sync:dify-model-metadata -- --gh-token=ghp_xxx
 *   npm run sync:dify-model-metadata -- -t ghp_xxx
 *   GITHUB_TOKEN=ghp_xxx npm run sync:dify-model-metadata
 *   gh_token=ghp_xxx npm run sync:dify-model-metadata   (same; lowercase env)
 *
 * Unauthenticated requests to api.github.com hit low rate limits; use a classic PAT
 * (repo read is enough) or fine-grained token with Contents read on public repos.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../lib/data/dify-model-metadata.json");

const API_ROOT = "https://api.github.com/repos/langgenius/dify-official-plugins/contents";

/** @returns {string} */
function parseGithubTokenFromArgv() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--gh-token" || a === "-t") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) return next.trim();
    }
    if (a.startsWith("--gh-token=")) {
      const v = a.slice("--gh-token=".length).trim();
      if (v) return v;
    }
  }
  return "";
}

function resolveGithubToken() {
  return (
    parseGithubTokenFromArgv() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.gh_token?.trim() ||
    ""
  );
}

const GITHUB_TOKEN = resolveGithubToken();

const githubApiHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "boardrule-rag-sync-dify-model-metadata",
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
};

/** JSON output key → GitHub path + subdirs under that path (each subdir = one category). */
const PLUGIN_SPECS = [
  { key: "qwen", base: "models/tongyi/models", subdirs: ["llm", "text_embedding"] },
  { key: "gemini", base: "models/gemini/models", subdirs: ["llm", "text_embedding"] },
  { key: "openrouter", base: "models/openrouter/models", subdirs: ["llm", "text_embedding"] },
  { key: "bedrock", base: "models/bedrock/models", subdirs: ["llm", "text_embedding"] },
  /** Anthropic plugin folder; app vendor id is `claude`. */
  { key: "claude", base: "models/anthropic/models", subdirs: ["llm", "text_embedding"] },
  /** Jina: embed + rerank only (no `llm` subdir in upstream). */
  { key: "jina", base: "models/jina/models", subdirs: ["text_embedding", "rerank"] },
];

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: githubApiHeaders,
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
  const category =
    subdir === "llm"
      ? "llm"
      : subdir === "text_embedding"
        ? "text_embedding"
        : subdir === "rerank"
          ? "rerank"
          : subdir;
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
  if (GITHUB_TOKEN) {
    process.stderr.write("GitHub API: using token from env or --gh-token (authenticated, higher rate limit).\n");
  } else {
    process.stderr.write(
      "GitHub API: unauthenticated (low rate limit). Set GITHUB_TOKEN / GH_TOKEN or pass --gh-token=…\n",
    );
  }

  /** @type {Record<string, Record<string, object>>} */
  const byVendor = {
    qwen: {},
    gemini: {},
    openrouter: {},
    bedrock: {},
    claude: {},
    jina: {},
  };

  for (const spec of PLUGIN_SPECS) {
    const merged = [];
    for (const sub of spec.subdirs) {
      const path = `${spec.base}/${sub}`;
      process.stderr.write(`Fetching ${path}...\n`);
      try {
        merged.push(...(await collectFromDir(path)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[${spec.key}] skip ${path}: ${msg}`);
      }
    }
    const bucket = byVendor[spec.key];
    if (!bucket) {
      console.warn(`[${spec.key}] unknown output key, skipping`);
      continue;
    }
    for (const e of merged) {
      const id = e.model;
      if (bucket[id]) {
        console.warn(`[${spec.key}] duplicate model key, keeping first: ${id}`);
        continue;
      }
      bucket[id] = e;
    }
    console.log(`[${spec.key}] ${Object.keys(bucket).length} models`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(byVendor, null, 2)}\n`, "utf8");
  console.log(`Wrote -> ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
