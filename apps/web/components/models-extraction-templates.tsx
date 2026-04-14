"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { GitBranch, Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import mermaid from "mermaid";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GeminiModelPicker } from "@/components/gemini-model-picker";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { AiGatewayPublic, SlotBinding } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";
import {
  type ExtractionProfileConfigParsed,
  type ExtractionRuntimeOverridesParsed,
  extractionProfileConfigSchema,
} from "@/lib/ai-runtime-profile-schema";

type ProfileRow = {
  id: string;
  name: string;
  description: string | null;
  kind: "EXTRACTION" | "CHAT";
  configJson: string;
};

const emptyExtractionConfig = (): ExtractionProfileConfigParsed => ({
  slotBindings: {},
});

function parseExtraction(raw: string): ExtractionProfileConfigParsed {
  return extractionProfileConfigSchema.parse(JSON.parse(raw || "{}"));
}

export function ModelsExtractionTemplates() {
  const mermaidRef = useRef<HTMLDivElement>(null);
  const mermaidId = useId();
  const [gateway, setGateway] = useState<AiGatewayPublic | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mermaidSrc, setMermaidSrc] = useState<string | null>(null);
  const [mermaidLoading, setMermaidLoading] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [extractionCfg, setExtractionCfg] = useState<ExtractionProfileConfigParsed>(emptyExtractionConfig);
  const [saving, setSaving] = useState(false);
  const [modelLists, setModelLists] = useState<Record<string, GeminiModelOption[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});

  const profileList = useMemo(() => profiles.filter((p) => p.kind === "EXTRACTION"), [profiles]);
  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const loadAll = useCallback(async () => {
    const [gRes, pRes] = await Promise.all([
      fetch("/api/ai-gateway"),
      fetch("/api/ai-runtime-profiles"),
    ]);
    if (!gRes.ok) throw new Error("无法加载 AI 网关");
    if (!pRes.ok) throw new Error("无法加载模版列表");
    const g = (await gRes.json()) as AiGatewayPublic;
    const pack = (await pRes.json()) as { profiles: ProfileRow[] };
    setGateway(g);
    setProfiles(pack.profiles);
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        await loadAll();
      } catch {
        if (!c) toast.error("加载失败");
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [loadAll]);

  useEffect(() => {
    if (selectedId && !profileList.some((p) => p.id === selectedId)) setSelectedId(null);
  }, [profiles, selectedId, profileList]);

  useEffect(() => {
    if (!selected || selected.kind !== "EXTRACTION") return;
    setEditName(selected.name);
    setEditDescription(selected.description ?? "");
    try {
      setExtractionCfg(parseExtraction(selected.configJson));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "配置解析失败");
    }
  }, [selected]);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "neutral" });
  }, []);

  useEffect(() => {
    if (!mermaidSrc || !mermaidRef.current) return;
    const id = `mmd-${mermaidId.replace(/:/g, "")}`;
    mermaidRef.current.innerHTML = "";
    mermaidRef.current.removeAttribute("data-processed");
    const el = document.createElement("div");
    el.className = "flex justify-center";
    el.innerHTML = `<pre class="mermaid" id="${id}">${mermaidSrc}</pre>`;
    mermaidRef.current.appendChild(el);
    mermaid.run({ querySelector: `#${id}` }).catch(() => {
      toast.error("Mermaid 渲染失败");
    });
  }, [mermaidSrc, mermaidId]);

  const fetchMermaid = useCallback(async () => {
    setMermaidLoading(true);
    try {
      const res = await fetch("/api/rule-engine/extraction-mermaid");
      const j = (await res.json()) as { mermaid?: string; message?: string };
      if (!res.ok) throw new Error(j.message || "获取流程图失败");
      setMermaidSrc(j.mermaid ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "获取流程图失败");
    } finally {
      setMermaidLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mermaidSrc === null && !mermaidLoading) void fetchMermaid();
  }, [mermaidSrc, mermaidLoading, fetchMermaid]);

  const fetchModels = useCallback(async (credentialId: string, slot: "flash" | "pro") => {
    if (!credentialId) return;
    const k = `${credentialId}:${slot}`;
    setLoadingModels((m) => ({ ...m, [k]: true }));
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId, slot }),
      });
      const json = (await res.json()) as { models?: GeminiModelOption[]; message?: string };
      if (!res.ok) throw new Error(json.message || "拉取模型失败");
      setModelLists((prev) => ({ ...prev, [k]: json.models ?? [] }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "拉取模型失败");
    } finally {
      setLoadingModels((m) => ({ ...m, [k]: false }));
    }
  }, []);

  const extractionBindingsKey = JSON.stringify(extractionCfg.slotBindings);
  useEffect(() => {
    if (!gateway || !selected || selected.kind !== "EXTRACTION") return;
    const sb = extractionCfg.slotBindings;
    for (const key of ["flashToc", "flashQuickstart"] as const) {
      const id = sb[key]?.credentialId?.trim();
      if (id) void fetchModels(id, "flash");
    }
    for (const key of ["proExtract", "proMerge"] as const) {
      const id = sb[key]?.credentialId?.trim();
      if (id) void fetchModels(id, "pro");
    }
  }, [gateway, selected?.id, selected?.kind, extractionBindingsKey, fetchModels]);

  const createProfile = async () => {
    try {
      const res = await fetch("/api/ai-runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "新提取模版",
          kind: "EXTRACTION",
          configJson: emptyExtractionConfig(),
        }),
      });
      const j = (await res.json()) as ProfileRow & { message?: string };
      if (!res.ok) throw new Error(j.message || "创建失败");
      toast.success("已创建");
      await loadAll();
      setSelectedId(j.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const saveSelected = async () => {
    if (!selected || selected.kind !== "EXTRACTION") return;
    setSaving(true);
    try {
      extractionProfileConfigSchema.parse(extractionCfg);
      const res = await fetch(`/api/ai-runtime-profiles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          configJson: extractionCfg,
        }),
      });
      const j = (await res.json()) as ProfileRow & { message?: string };
      if (!res.ok) throw new Error(j.message || "保存失败");
      toast.success("已保存");
      await loadAll();
      setSelectedId(j.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (!confirm(`删除模版「${selected.name}」？`)) return;
    const res = await fetch(`/api/ai-runtime-profiles/${selected.id}`, { method: "DELETE" });
    const j = (await res.json()) as { message?: string };
    if (!res.ok) {
      toast.error(j.message || "删除失败");
      return;
    }
    toast.success("已删除");
    setSelectedId(null);
    await loadAll();
  };

  const renderSlotRow = (
    label: string,
    hint: string,
    binding: SlotBinding | null | undefined,
    slot: "flash" | "pro",
    onChange: (next: SlotBinding | null) => void,
    allowClear = true,
  ) => {
    const creds = gateway?.credentials.filter((c) => c.enabled) ?? [];
    const cid = binding?.credentialId ?? "";
    const model = binding?.model ?? "";
    const k = `${cid}:${slot}`;
    const models = modelLists[k] ?? [];
    const maxOut = binding?.maxOutputTokens != null ? String(binding.maxOutputTokens) : "";
    return (
      <div className="border-border space-y-3 rounded-lg border p-4">
        <div>
          <div className="font-medium">{label}</div>
          <p className="text-muted-foreground text-xs">{hint}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>凭证</FieldLabel>
            <Select
              value={allowClear ? cid || "__none__" : cid || ""}
              onValueChange={(v) => {
                if (v === "__none__" && allowClear) onChange(null);
                else if (v !== "__none__") {
                  onChange({
                    ...binding,
                    credentialId: v,
                    model: binding?.model ?? "",
                  });
                  void fetchModels(v, slot);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择凭证" />
              </SelectTrigger>
              <SelectContent>
                {allowClear ? (
                  <SelectItem value="__none__">（未覆盖 — 引擎回退到粗粒度 Flash/Pro）</SelectItem>
                ) : null}
                {creds.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.alias} ({c.vendor})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>模型</FieldLabel>
            <GeminiModelPicker
              slot={slot}
              vendor={
                cid ? (gateway?.credentials.find((c) => c.id === cid)?.vendor ?? "gemini") : "gemini"
              }
              models={models}
              value={model}
              onChange={(v) =>
                onChange({
                  ...binding,
                  credentialId: cid,
                  model: v,
                })
              }
              loading={Boolean(loadingModels[k])}
              disabled={!cid}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel>最大输出 tokens（可选）</FieldLabel>
          <Input
            value={maxOut}
            placeholder="留空则使用引擎默认"
            onChange={(e) => {
              const t = e.target.value.trim();
              const next: SlotBinding = {
                credentialId: cid,
                model,
                ...(t === "" ? {} : { maxOutputTokens: Math.max(1, Math.trunc(Number(t)) || 1) }),
              };
              onChange(binding ? { ...binding, ...next } : next);
            }}
          />
        </Field>
      </div>
    );
  };

  const setExtractionRuntimeField = (
    field: keyof ExtractionRuntimeOverridesParsed,
    raw: string,
  ) => {
    setExtractionCfg((c) => {
      const base = { ...(c.extractionRuntime ?? {}) };
      const t = raw.trim();
      if (t === "") {
        delete (base as Record<string, unknown>)[field];
      } else {
        const n = Number(t);
        if (!Number.isFinite(n)) return c;
        (base as Record<string, number>)[field as string] = n;
      }
      return {
        ...c,
        extractionRuntime: Object.keys(base).length > 0 ? base : undefined,
      };
    });
  };

  if (loading || !gateway) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        API 凭证在「
        <a href="/models/credentials" className="text-primary underline underline-offset-2">
          凭证管理
        </a>
        」添加。游戏页开始提取时必须选择一套提取模版；请至少为 TOC/Quickstart 之一与 Extract/Merge 之一配置模型（用于引擎 Flash/Pro 基线）。
      </p>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardHeader className="space-y-4">
            <CardTitle className="text-base">提取模版</CardTitle>
            <Button type="button" variant="outline" size="sm" className="w-full gap-1" onClick={() => void createProfile()}>
              <Plus className="h-4 w-4" />
              新建模版
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {profileList.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无模版</p>
            ) : (
              profileList.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={
                    selectedId === p.id
                      ? "bg-primary/10 text-primary w-full rounded-md px-2 py-2 text-left text-sm"
                      : "hover:bg-muted w-full rounded-md px-2 py-2 text-left text-sm"
                  }
                >
                  {p.name}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {!selected || selected.kind !== "EXTRACTION" ? (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center text-sm">
                请选择左侧模版或新建
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                  <CardDescription>
                    按管线顺序：目录分析 → 快路径 → 章节提取 → 合并。未填的细粒度槽位在引擎侧回退到本模版推导的 Flash/Pro 基线。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FieldGroup>
                    <Field>
                      <FieldLabel>名称</FieldLabel>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>说明</FieldLabel>
                      <Textarea
                        rows={2}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>

                  {renderSlotRow(
                    "TOC Flash",
                    "toc_analyzer",
                    extractionCfg.slotBindings.flashToc ?? null,
                    "flash",
                    (b) =>
                      setExtractionCfg((c) => ({
                        ...c,
                        slotBindings: { ...c.slotBindings, flashToc: b },
                      })),
                  )}
                  {renderSlotRow(
                    "Quickstart Flash",
                    "quickstart_and_questions",
                    extractionCfg.slotBindings.flashQuickstart ?? null,
                    "flash",
                    (b) =>
                      setExtractionCfg((c) => ({
                        ...c,
                        slotBindings: { ...c.slotBindings, flashQuickstart: b },
                      })),
                  )}
                  {renderSlotRow(
                    "Extract Pro",
                    "chapter_extract",
                    extractionCfg.slotBindings.proExtract ?? null,
                    "pro",
                    (b) =>
                      setExtractionCfg((c) => ({
                        ...c,
                        slotBindings: { ...c.slotBindings, proExtract: b },
                      })),
                  )}
                  {renderSlotRow(
                    "Merge Pro",
                    "merge_and_refine",
                    extractionCfg.slotBindings.proMerge ?? null,
                    "pro",
                    (b) =>
                      setExtractionCfg((c) => ({
                        ...c,
                        slotBindings: { ...c.slotBindings, proMerge: b },
                      })),
                  )}

                  <Collapsible>
                    <CollapsibleTrigger className="text-primary flex items-center gap-2 text-sm font-medium">
                      <Sparkles className="h-4 w-4" />
                      节点与环境覆盖
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4 space-y-3">
                      <p className="text-muted-foreground text-xs">
                        未填写时继承规则引擎环境变量（见{" "}
                        <code className="text-xs">services/rule_engine/.env.example</code>）。
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            ["visionBatchPages", "每批视觉页数（VISION_BATCH_PAGES）"],
                            ["extractionSimpleMaxBodyPages", "简单路径正文页上限"],
                            ["extractionComplexRouteBodyPages", "复杂路由正文页阈值"],
                            [
                              "extractionSimplePathWarnBodyPages",
                              "简单路径单批正文页告警阈值（仅打日志）",
                            ],
                            ["visionMaxMergePages", "NEED_MORE_CONTEXT 合并时单请求最多几页图"],
                            ["needMoreContextMaxExpand", "NEED_MORE_CONTEXT 邻批合并最多步数"],
                            ["llmMaxContinuationRounds", "输出截断后续写轮数"],
                          ] as const
                        ).map(([field, lab]) => (
                          <Field key={field}>
                            <FieldLabel>{lab}</FieldLabel>
                            <Input
                              type="number"
                              min={0}
                              placeholder="继承环境"
                              value={
                                extractionCfg.extractionRuntime?.[field] != null
                                  ? String(extractionCfg.extractionRuntime[field])
                                  : ""
                              }
                              onChange={(e) => setExtractionRuntimeField(field, e.target.value)}
                            />
                          </Field>
                        ))}
                      </div>
                      <p className="text-muted-foreground text-xs">HTTP 超时（毫秒）</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            [
                              "geminiHttpTimeoutMs",
                              "Gemini / Google GenAI（填 0 表示客户端不限制）",
                            ],
                            ["dashscopeHttpTimeoutMs", "DashScope（Qwen 等）"],
                            ["openrouterHttpTimeoutMs", "OpenRouter"],
                          ] as const
                        ).map(([field, lab]) => (
                          <Field key={field}>
                            <FieldLabel>{lab}</FieldLabel>
                            <Input
                              type="number"
                              min={0}
                              step={1000}
                              placeholder="继承环境"
                              value={
                                extractionCfg.extractionRuntime?.[field] != null
                                  ? String(extractionCfg.extractionRuntime[field])
                                  : ""
                              }
                              onChange={(e) => setExtractionRuntimeField(field, e.target.value)}
                            />
                          </Field>
                        ))}
                      </div>
                      <Field className="flex flex-row items-center gap-2">
                        <Checkbox
                          checked={extractionCfg.forceFullPipelineDefault === true}
                          onCheckedChange={(v) =>
                            setExtractionCfg((c) => ({
                              ...c,
                              forceFullPipelineDefault: v === true,
                            }))
                          }
                        />
                        <span className="text-sm">默认强制完整管线（可与游戏页「强制」叠加为 OR）</span>
                      </Field>
                    </CollapsibleContent>
                  </Collapsible>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void saveSelected()} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      保存
                    </Button>
                    <Button type="button" variant="destructive" onClick={() => void deleteSelected()}>
                      <Trash2 className="h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <GitBranch className="h-4 w-4" />
                    提取流程（只读）
                  </CardTitle>
                  <CardDescription>LangGraph 编译图，与引擎一致。</CardDescription>
                </CardHeader>
                <CardContent>
                  {mermaidLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <div ref={mermaidRef} className="bg-muted/30 overflow-x-auto rounded-md p-4 text-sm" />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
