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
import {
  EXTRACTION_RUNTIME_DEFAULTS,
  EXTRACTION_SLOT_MAX_OUTPUT_DEFAULT,
  defaultVisionMaxMergePages,
} from "@/lib/rule-engine-defaults";
import { normalizeExtractionMermaidSource } from "@/lib/extraction-mermaid";

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
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
  }, []);

  useEffect(() => {
    const raw = typeof mermaidSrc === "string" ? mermaidSrc.trim() : "";
    if (!raw || !mermaidRef.current) return;
    const id = `mmd-${mermaidId.replace(/:/g, "")}`;
    mermaidRef.current.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "flex w-full justify-center overflow-x-auto";
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.id = id;
    // Must use textContent: LangGraph output contains `<p>...</p>` in node labels; innerHTML would parse those as DOM nodes and corrupt the diagram source.
    pre.textContent = normalizeExtractionMermaidSource(raw);
    wrapper.appendChild(pre);
    mermaidRef.current.appendChild(wrapper);
    void mermaid.run({ nodes: [pre] }).catch((err) => {
      console.error("Mermaid render failed:", err);
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
          <p className="text-muted-foreground text-xs leading-relaxed">
            留空则使用规则引擎默认{" "}
            <span className="text-foreground font-medium tabular-nums">
              {EXTRACTION_SLOT_MAX_OUTPUT_DEFAULT.toLocaleString()}
            </span>{" "}
           （亦可通过服务器环境变量覆盖 Flash / Pro）。
          </p>
          <Input
            value={maxOut}
            placeholder={`默认 ${EXTRACTION_SLOT_MAX_OUTPUT_DEFAULT.toLocaleString()}`}
            onChange={(e) => {
              const t = e.target.value.trim();
              const merged: SlotBinding = {
                ...(binding ?? { credentialId: cid, model }),
                credentialId: cid,
                model,
              };
              if (t === "") {
                delete merged.maxOutputTokens;
              } else {
                const n = Math.trunc(Number(t));
                if (!Number.isFinite(n) || n < 1) return;
                merged.maxOutputTokens = n;
              }
              onChange(merged);
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

  const mergePagesHint = defaultVisionMaxMergePages(EXTRACTION_RUNTIME_DEFAULTS.visionBatchPages);

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm leading-relaxed">
        API 凭证在「
        <a
          href="/models/credentials"
          className="text-primary underline underline-offset-2 transition-colors hover:text-primary/90"
        >
          凭证管理
        </a>
        」添加。游戏页开始提取时必须选择一套提取模版；请至少为 TOC / Quickstart 之一与 Extract / Merge 之一配置模型（用于引擎 Flash / Pro 基线）。
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 shrink-0" aria-hidden />
            提取流程（只读）
          </CardTitle>
          <CardDescription>
            LangGraph 编译图，与 rule_engine 一致；不随左侧模版切换而变化，便于对照各节点与下方槽位命名。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative min-h-[140px]">
            {mermaidLoading ? (
              <div
                className="bg-muted/20 absolute inset-0 z-10 flex items-center justify-center rounded-md border border-border/40"
                aria-busy
                aria-label="加载流程图"
              >
                <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" aria-hidden />
              </div>
            ) : null}
            <div
              ref={mermaidRef}
              className="bg-muted/30 overflow-x-auto rounded-md border border-border/60 p-4 text-sm min-h-[120px]"
            />
          </div>
        </CardContent>
      </Card>

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
                      ? "bg-primary/10 text-primary w-full cursor-pointer rounded-md px-2 py-2 text-left text-sm transition-colors"
                      : "hover:bg-muted w-full cursor-pointer rounded-md px-2 py-2 text-left text-sm transition-colors"
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
              <CardHeader>
                <CardTitle className="text-base">编辑提取模版</CardTitle>
                <CardDescription>
                  从左侧选择已有模版，或点击「新建模版」以配置各节点模型与可选的运行时覆盖。上方流程图始终展示当前引擎拓扑。
                </CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground py-6 text-center text-sm">
                请选择左侧模版或新建后开始编辑
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

                  <Collapsible defaultOpen>
                    <CollapsibleTrigger className="text-primary hover:text-primary/90 flex cursor-pointer items-center gap-2 text-sm font-medium transition-colors">
                      <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
                      节点与环境覆盖
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4 space-y-4">
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        以下为可选覆盖：留空表示<strong>不写入模版</strong>，运行时使用规则引擎进程的环境变量或代码内默认值（与{" "}
                        <code className="rounded bg-muted px-1 py-0.5 text-[11px]">services/rule_engine/.env.example</code>{" "}
                        对照）。一般无需填写，除非你要针对该模版固定不同数值。
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {(
                          [
                            [
                              "visionBatchPages",
                              "每批视觉页数",
                              `VISION_BATCH_PAGES · 默认 ${EXTRACTION_RUNTIME_DEFAULTS.visionBatchPages}`,
                            ],
                            [
                              "extractionSimpleMaxBodyPages",
                              "简单路径：正文页数上限",
                              `EXTRACTION_SIMPLE_MAX_BODY_PAGES · 默认 ${EXTRACTION_RUNTIME_DEFAULTS.extractionSimpleMaxBodyPages}（超过则不走简单画像）`,
                            ],
                            [
                              "extractionComplexRouteBodyPages",
                              "复杂路由：正文页阈值",
                              `EXTRACTION_COMPLEX_ROUTE_BODY_PAGES · 默认 ${EXTRACTION_RUNTIME_DEFAULTS.extractionComplexRouteBodyPages}`,
                            ],
                            [
                              "extractionSimplePathWarnBodyPages",
                              "简单路径单批页数告警",
                              `EXTRACTION_SIMPLE_PATH_WARN_BODY_PAGES · 默认 ${EXTRACTION_RUNTIME_DEFAULTS.extractionSimplePathWarnBodyPages}（仅日志）`,
                            ],
                            [
                              "visionMaxMergePages",
                              "合并批次时单请求最多页图",
                              `VISION_MAX_MERGE_PAGES · 未设时引擎按批次计算（示例批次 ${EXTRACTION_RUNTIME_DEFAULTS.visionBatchPages} → 约 ${mergePagesHint}）`,
                            ],
                            [
                              "needMoreContextMaxExpand",
                              "NEED_MORE_CONTEXT 邻批合并最多步数",
                              `NEED_MORE_CONTEXT_MAX_EXPAND · 默认 ${EXTRACTION_RUNTIME_DEFAULTS.needMoreContextMaxExpand}`,
                            ],
                            [
                              "llmMaxContinuationRounds",
                              "输出截断后续写轮数",
                              `BOARDRULE_LLM_MAX_CONTINUATION_ROUNDS · 默认 ${EXTRACTION_RUNTIME_DEFAULTS.llmMaxContinuationRounds}`,
                            ],
                          ] as const
                        ).map(([field, title, hint]) => (
                          <Field key={field}>
                            <FieldLabel>{title}</FieldLabel>
                            <p className="text-muted-foreground mb-1.5 text-xs leading-relaxed">{hint}</p>
                            <Input
                              type="number"
                              min={0}
                              placeholder={
                                field === "visionMaxMergePages"
                                  ? `示例默认 ${mergePagesHint}`
                                  : String(EXTRACTION_RUNTIME_DEFAULTS[field as keyof typeof EXTRACTION_RUNTIME_DEFAULTS] ?? "")
                              }
                              className="tabular-nums"
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
                      <p className="text-foreground text-sm font-medium">HTTP 超时（毫秒）</p>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        Gemini 空环境时为 {EXTRACTION_RUNTIME_DEFAULTS.geminiHttpTimeoutMs.toLocaleString()} ms；填{" "}
                        <span className="tabular-nums">0</span> 表示由客户端不限制（见引擎逻辑）。
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {(
                          [
                            [
                              "geminiHttpTimeoutMs",
                              "Gemini / Google GenAI",
                              `默认 ${EXTRACTION_RUNTIME_DEFAULTS.geminiHttpTimeoutMs.toLocaleString()} ms`,
                            ],
                            [
                              "dashscopeHttpTimeoutMs",
                              "DashScope（Qwen 等）",
                              `默认 ${EXTRACTION_RUNTIME_DEFAULTS.dashscopeHttpTimeoutMs.toLocaleString()} ms（空环境）`,
                            ],
                            [
                              "openrouterHttpTimeoutMs",
                              "OpenRouter",
                              `默认 ${EXTRACTION_RUNTIME_DEFAULTS.openrouterHttpTimeoutMs.toLocaleString()} ms（空环境）`,
                            ],
                          ] as const
                        ).map(([field, title, hint]) => (
                          <Field key={field}>
                            <FieldLabel>{title}</FieldLabel>
                            <p className="text-muted-foreground mb-1.5 text-xs">{hint}</p>
                            <Input
                              type="number"
                              min={0}
                              step={1000}
                              placeholder={String(EXTRACTION_RUNTIME_DEFAULTS[field])}
                              className="tabular-nums"
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
                      <div className="bg-muted/40 rounded-lg border border-border/60 p-4">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id="force-full-pipeline"
                            className="mt-1 shrink-0"
                            checked={extractionCfg.forceFullPipelineDefault === true}
                            onCheckedChange={(v) =>
                              setExtractionCfg((c) => ({
                                ...c,
                                forceFullPipelineDefault: v === true,
                              }))
                            }
                          />
                          <div className="min-w-0 space-y-1">
                            <label
                              htmlFor="force-full-pipeline"
                              className="cursor-pointer text-sm font-medium leading-snug"
                            >
                              默认强制完整管线
                            </label>
                            <p className="text-muted-foreground text-xs leading-relaxed">
                              勾选后本模版默认走完整提取图；可与游戏页的「强制完整管线」做逻辑或（任一满足即生效）。未勾选时仍由页数与路由策略决定简单/复杂路径。
                            </p>
                          </div>
                        </div>
                      </div>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
