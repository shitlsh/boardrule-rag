import type { AiModelOption } from "@/lib/ai-model-option";

/** Options for which synthetic tags are considered (embed 槽位不展示 VISION 筛选). */
export type ModelTagFilterOptions = {
  showVisionFilter: boolean;
};

export function modelVisionEffective(
  m: AiModelOption,
  opts: ModelTagFilterOptions,
): boolean {
  if (!opts.showVisionFilter) return false;
  return m.supportsVision === true || (m.supportsVision !== false && m.visionHint);
}

/** Stable tag ids for a row: vision, mode:*, has_context, has_output_cap. */
export function getModelTagIds(m: AiModelOption, opts: ModelTagFilterOptions): string[] {
  const keys: string[] = [];
  if (modelVisionEffective(m, opts)) keys.push("vision");
  const mode = m.modelMode?.trim().toLowerCase();
  if (mode) keys.push(`mode:${mode}`);
  if (m.inputTokenLimit != null && m.inputTokenLimit > 0) keys.push("has_context");
  if (m.outputTokenLimit != null && m.outputTokenLimit > 0) keys.push("has_output_cap");
  return keys;
}

function tagSortKey(id: string): number {
  if (id === "vision") return 0;
  if (id.startsWith("mode:")) return 1;
  if (id === "has_context") return 2;
  if (id === "has_output_cap") return 3;
  return 9;
}

/** Tag ids that appear on at least one model in the list (for filter chips). */
export function listAvailableTagIds(models: AiModelOption[], opts: ModelTagFilterOptions): string[] {
  const s = new Set<string>();
  for (const m of models) {
    for (const k of getModelTagIds(m, opts)) s.add(k);
  }
  return Array.from(s).sort((a, b) => {
    const d = tagSortKey(a) - tagSortKey(b);
    if (d !== 0) return d;
    return a.localeCompare(b);
  });
}

/** AND: model must have every selected tag. Empty selection → no extra filtering. */
export function filterModelsByTagIds(
  models: AiModelOption[],
  selectedIds: string[],
  opts: ModelTagFilterOptions,
): AiModelOption[] {
  if (selectedIds.length === 0) return models;
  return models.filter((m) => {
    const keys = new Set(getModelTagIds(m, opts));
    return selectedIds.every((id) => keys.has(id));
  });
}

export function modelTagIdLabel(id: string): string {
  if (id === "vision") return "VISION";
  if (id === "has_context") return "有上下文";
  if (id === "has_output_cap") return "有输出上限";
  if (id.startsWith("mode:")) {
    return id.slice(5).toUpperCase().replace(/-/g, "_");
  }
  return id;
}
