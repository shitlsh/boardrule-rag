/** DashScope OpenAI-compatible API base (百炼). Shared by UI + server. */

export const DASHSCOPE_COMPATIBLE_BASE_DEFAULT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** 国际（新加坡等）常用 endpoint，与阿里云文档一致时可在此更新。 */
export const DASHSCOPE_COMPATIBLE_BASE_INTL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export type DashscopePresetId = "cn" | "intl" | "custom";

export const DASHSCOPE_ENDPOINT_PRESETS: readonly {
  id: Exclude<DashscopePresetId, "custom">;
  label: string;
  base: string;
}[] = [
  { id: "cn", label: "中国（北京）", base: DASHSCOPE_COMPATIBLE_BASE_DEFAULT },
  { id: "intl", label: "国际（新加坡）", base: DASHSCOPE_COMPATIBLE_BASE_INTL },
];

/** Trim trailing slashes; empty → default Beijing. */
export function normalizeDashscopeCompatibleBase(raw: string | undefined | null): string {
  const t = (raw ?? "").trim().replace(/\/+$/, "");
  if (!t) return DASHSCOPE_COMPATIBLE_BASE_DEFAULT;
  return t;
}

export function presetIdForBase(base: string): DashscopePresetId {
  const n = normalizeDashscopeCompatibleBase(base);
  for (const p of DASHSCOPE_ENDPOINT_PRESETS) {
    if (p.base === n) return p.id;
  }
  return "custom";
}

/** Basic validation for save / API (https URL, no trailing slash). */
export function assertValidDashscopeCompatibleBase(raw: string): void {
  const n = raw.trim().replace(/\/+$/, "");
  if (!n) throw new Error("百炼接入点 URL 不能为空");
  let u: URL;
  try {
    u = new URL(n);
  } catch {
    throw new Error("百炼接入点必须是有效 URL");
  }
  if (u.protocol !== "https:") {
    throw new Error("百炼接入点须使用 https");
  }
}
