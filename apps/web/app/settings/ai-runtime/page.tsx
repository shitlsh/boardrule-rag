"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GitBranch, Layers, Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import mermaid from "mermaid";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { AiGatewayPublic, RagOptionsStored, SlotBinding } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";
import {
  type ChatProfileConfigParsed,
  type ExtractionProfileConfigParsed,
  type ExtractionRuntimeOverridesParsed,
  chatProfileConfigSchema,
  extractionProfileConfigSchema,
} from "@/lib/ai-runtime-profile-schema";

type ProfileRow = {
  id: string;
  name: string;
  description: string | null;
  kind: "EXTRACTION" | "CHAT";
  configJson: string;
  createdAt: string;
  updatedAt: string;
};

const emptyExtractionConfig = (): ExtractionProfileConfigParsed => ({
  slotBindings: {},
});

const emptyChatConfig = (): ChatProfileConfigParsed => ({
  chat: { credentialId: "", model: "" },
  ragOptions: {},
});

function parseConfig(kind: "EXTRACTION" | "CHAT", raw: string): ExtractionProfileConfigParsed | ChatProfileConfigParsed {
  const data = JSON.parse(raw || "{}");
  if (kind === "EXTRACTION") {
    return extractionProfileConfigSchema.parse(data);
  }
  return chatProfileConfigSchema.parse(data);
}

export default function AiRuntimeSettingsPage() {
  const mermaidRef = useRef<HTMLDivElement>(null);
  const mermaidId = useId();
  const [gateway, setGateway] = useState<AiGatewayPublic | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [activeChatProfileId, setActiveChatProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kindTab, setKindTab] = useState<"EXTRACTION" | "CHAT">("EXTRACTION");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mermaidSrc, setMermaidSrc] = useState<string | null>(null);
  const [mermaidLoading, setMermaidLoading] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [extractionCfg, setExtractionCfg] = useState<ExtractionProfileConfigParsed>(emptyExtractionConfig);
  const [chatCfg, setChatCfg] = useState<ChatProfileConfigParsed>(emptyChatConfig);
  const [saving, setSaving] = useState(false);
  const [modelLists, setModelLists] = useState<Record<string, GeminiModelOption[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const loadAll = useCallback(async () => {
    const [gRes, pRes] = await Promise.all([
      fetch("/api/ai-gateway"),
      fetch("/api/ai-runtime-profiles"),
    ]);
    if (!gRes.ok) throw new Error("无法加载 AI 网关");
    if (!pRes.ok) throw new Error("无法加载模版列表");
    const g = (await gRes.json()) as AiGatewayPublic;
    const pack = (await pRes.json()) as {
      profiles: ProfileRow[];
      activeChatProfileId: string | null;
    };
    setGateway(g);
    setProfiles(pack.profiles);
    setActiveChatProfileId(pack.activeChatProfileId);
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
    if (!selected) return;
    setEditName(selected.name);
    setEditDescription(selected.description ?? "");
    try {
      if (selected.kind === "EXTRACTION") {
        setExtractionCfg(parseConfig("EXTRACTION", selected.configJson) as ExtractionProfileConfigParsed);
      } else {
        setChatCfg(parseConfig("CHAT", selected.configJson) as ChatProfileConfigParsed);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "配置解析失败");
    }
  }, [selected]);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "neutral" });
  }, []);

  useEffect(() => {
    if (kindTab !== "EXTRACTION" || !mermaidSrc || !mermaidRef.current) return;
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
  }, [kindTab, mermaidSrc, mermaidId]);

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
    if (kindTab === "EXTRACTION" && mermaidSrc === null && !mermaidLoading) {
      void fetchMermaid();
    }
  }, [kindTab, mermaidSrc, mermaidLoading, fetchMermaid]);

  const fetchModels = async (credentialId: string, slot: "flash" | "pro" | "chat") => {
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
  };

  const createProfile = async (kind: "EXTRACTION" | "CHAT") => {
    try {
      const configJson =
        kind === "EXTRACTION"
          ? emptyExtractionConfig()
          : {
              ...emptyChatConfig(),
              chat: {
                credentialId: gateway?.credentials[0]?.id ?? "",
                model: "",
                temperature: gateway?.chatOptions.temperature ?? 0.2,
                maxTokens: gateway?.chatOptions.maxTokens ?? 8192,
              },
            };
      if (kind === "CHAT" && !gateway?.credentials[0]?.id) {
        toast.error("请先在「模型管理」中添加至少一个 API 凭证");
        return;
      }
      const res = await fetch("/api/ai-runtime-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: kind === "EXTRACTION" ? "新提取模版" : "新聊天模版",
          kind,
          configJson,
        }),
      });
      const j = (await res.json()) as ProfileRow & { message?: string };
      if (!res.ok) throw new Error(j.message || "创建失败");
      toast.success("已创建");
      await loadAll();
      setKindTab(kind);
      setSelectedId(j.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const saveSelected = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      let configJson: ExtractionProfileConfigParsed | ChatProfileConfigParsed;
      if (selected.kind === "EXTRACTION") {
        extractionProfileConfigSchema.parse(extractionCfg);
        configJson = extractionCfg;
      } else {
        chatProfileConfigSchema.parse(chatCfg);
        configJson = chatCfg;
      }
      const res = await fetch(`/api/ai-runtime-profiles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          configJson,
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

  const setActiveChat = async (id: string | null) => {
    const res = await fetch("/api/ai-runtime-profiles/active-chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeChatProfileId: id }),
    });
    const j = (await res.json()) as { activeChatProfileId?: string | null; message?: string };
    if (!res.ok) {
      toast.error(j.message || "更新失败");
      return;
    }
    setActiveChatProfileId(j.activeChatProfileId ?? null);
    toast.success(id ? "已切换全局聊天模版" : "已恢复为仅使用「模型管理」默认");
  };

  const renderSlotRow = (
    label: string,
    hint: string,
    binding: SlotBinding | null | undefined,
    slot: "flash" | "pro" | "chat",
    onChange: (next: SlotBinding | null) => void,
    allowClear = true,
  ) => {
    const creds = gateway?.credentials.filter((c) => c.enabled) ?? [];
    const cid = binding?.credentialId ?? "";
    const model = binding?.model ?? "";
    const k = `${cid}:${slot}`;
    const models = modelLists[k] ?? [];
    const maxOut =
      slot !== "chat"
        ? (binding?.maxOutputTokens != null ? String(binding.maxOutputTokens) : "")
        : "";
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
                    ...(slot === "chat"
                      ? {
                          temperature: binding?.temperature ?? gateway?.chatOptions.temperature ?? 0.2,
                          maxTokens: binding?.maxTokens ?? gateway?.chatOptions.maxTokens ?? 8192,
                        }
                      : {}),
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
                  <SelectItem value="__none__">（未覆盖 — 使用全局 Flash/Pro）</SelectItem>
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
            <div className="flex gap-2">
              <Select
                value={model && models.some((m) => m.name === model) ? model : ""}
                onValueChange={(v) =>
                  onChange({
                    ...binding,
                    credentialId: cid,
                    model: v,
                    ...(slot === "chat"
                      ? {
                          temperature: binding?.temperature ?? gateway?.chatOptions.temperature ?? 0.2,
                          maxTokens: binding?.maxTokens ?? gateway?.chatOptions.maxTokens ?? 8192,
                        }
                      : {}),
                  })
                }
                disabled={!cid || loadingModels[k]}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={loadingModels[k] ? "加载中…" : "选择模型"} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.name} value={m.name}>
                      {m.displayName ?? m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="flex-1 font-mono text-xs"
                placeholder="或手动填写模型 ID"
                value={model}
                onChange={(e) =>
                  onChange({
                    ...binding,
                    credentialId: cid,
                    model: e.target.value,
                    ...(slot === "chat"
                      ? {
                          temperature: binding?.temperature ?? 0.2,
                          maxTokens: binding?.maxTokens ?? 8192,
                        }
                      : {}),
                  })
                }
              />
            </div>
          </Field>
        </div>
        {slot !== "chat" ? (
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
                  ...(t === ""
                    ? {}
                    : { maxOutputTokens: Math.max(1, Math.trunc(Number(t)) || 1) }),
                };
                onChange(binding ? { ...binding, ...next } : next);
              }}
            />
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>temperature</FieldLabel>
              <Input
                type="number"
                step="0.1"
                value={binding?.temperature ?? ""}
                onChange={(e) =>
                  onChange({
                    credentialId: cid,
                    model,
                    temperature: Number(e.target.value),
                    maxTokens: binding?.maxTokens ?? 8192,
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel>maxTokens</FieldLabel>
              <Input
                type="number"
                value={binding?.maxTokens ?? ""}
                onChange={(e) =>
                  onChange({
                    credentialId: cid,
                    model,
                    temperature: binding?.temperature ?? 0.2,
                    maxTokens: Math.max(1, Math.trunc(Number(e.target.value)) || 8192),
                  })
                }
              />
            </Field>
          </div>
        )}
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

  const updateChatRag = (patch: Partial<RagOptionsStored>) => {
    setChatCfg((c) => ({
      ...c,
      ragOptions: { ...(c.ragOptions ?? {}), ...patch },
    }));
  };

  if (loading || !gateway) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const list = profiles.filter((p) => p.kind === kindTab);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-1 pb-16">
      <div className="flex items-start gap-3 pt-1">
        <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI 运行时模版</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl text-pretty">
            提取管线可细分四个模型槽位与节点参数；聊天模版覆盖 Chat 槽与 RAG 默认。凭证仍在
            <a href="/models" className="underline underline-offset-2">
              模型管理
            </a>
            维护。
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">全局：当前聊天生效模版</CardTitle>
          <CardDescription>
            影响站内聊天与建索引时的默认 RAG 参数（凭证仍来自「模型管理」）。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Label className="mb-2 block text-sm">聊天模版</Label>
            <Select
              value={activeChatProfileId ?? "__default__"}
              onValueChange={(v) => void setActiveChat(v === "__default__" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">兼容模式（仅「模型管理」槽位与 RAG）</SelectItem>
                {profiles
                  .filter((p) => p.kind === "CHAT")
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardHeader className="space-y-4">
            <div className="bg-muted grid grid-cols-2 rounded-lg p-1 text-sm">
              <button
                type="button"
                className={
                  kindTab === "EXTRACTION"
                    ? "bg-background shadow-sm rounded-md py-2 font-medium"
                    : "rounded-md py-2 text-muted-foreground"
                }
                onClick={() => setKindTab("EXTRACTION")}
              >
                提取
              </button>
              <button
                type="button"
                className={
                  kindTab === "CHAT"
                    ? "bg-background shadow-sm rounded-md py-2 font-medium"
                    : "rounded-md py-2 text-muted-foreground"
                }
                onClick={() => setKindTab("CHAT")}
              >
                聊天
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-1"
              onClick={() => void createProfile(kindTab)}
            >
              <Plus className="h-4 w-4" />
              新建模版
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {list.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无模版</p>
            ) : (
              list.map((p) => (
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
          {kindTab === "EXTRACTION" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="h-4 w-4" />
                  提取流程（只读）
                </CardTitle>
                <CardDescription>由 LangGraph 编译图生成，与引擎代码一致。</CardDescription>
              </CardHeader>
              <CardContent>
                {mermaidLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div
                    ref={mermaidRef}
                    className="bg-muted/30 overflow-x-auto rounded-md p-4 text-sm"
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          {!selected ? (
            <Card>
              <CardContent className="text-muted-foreground py-12 text-center text-sm">
                请选择左侧模版或新建
              </CardContent>
            </Card>
          ) : selected.kind === "EXTRACTION" ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{selected.name}</CardTitle>
                  <CardDescription>细粒度槽位未填时，规则引擎回退到「模型管理」中的 Flash / Pro。</CardDescription>
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
                    "对应 toc_analyzer 节点",
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
                    "对应 quickstart_and_questions 节点",
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
                    "对应 chapter_extract 节点",
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
                    "对应 merge_and_refine 节点",
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
                        未填写时继承规则引擎进程的环境变量（见{" "}
                        <code className="text-xs">services/rule_engine/.env.example</code>
                        ）。以下为提取管线常用覆盖项；嵌入批大小、槽位默认 maxOutput 等仍建议只在部署环境配置。
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
                        <span className="text-sm">默认强制完整管线（可与游戏页「强制」选项叠加为 OR）</span>
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
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{selected.name}</CardTitle>
                <CardDescription>覆盖 Chat 槽与 RAG 默认（用于对话与建索引）。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
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
                  "Chat 槽位",
                  "RAG 回答合成",
                  chatCfg.chat,
                  "chat",
                  (b) => {
                    if (!b) return;
                    setChatCfg((c) => ({ ...c, chat: b }));
                  },
                  false,
                )}

                <div>
                  <h3 className="mb-2 text-sm font-medium">RAG / 建索引默认</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>rerankModel</FieldLabel>
                      <Input
                        value={chatCfg.ragOptions?.rerankModel ?? ""}
                        onChange={(e) => updateChatRag({ rerankModel: e.target.value || undefined })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>chunkSize</FieldLabel>
                      <Input
                        value={
                          chatCfg.ragOptions?.chunkSize != null ? String(chatCfg.ragOptions.chunkSize) : ""
                        }
                        onChange={(e) => {
                          const t = e.target.value.trim();
                          updateChatRag(
                            t === "" ? { chunkSize: undefined } : { chunkSize: Math.trunc(Number(t)) },
                          );
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>chunkOverlap</FieldLabel>
                      <Input
                        value={
                          chatCfg.ragOptions?.chunkOverlap != null
                            ? String(chatCfg.ragOptions.chunkOverlap)
                            : ""
                        }
                        onChange={(e) => {
                          const t = e.target.value.trim();
                          updateChatRag(
                            t === "" ? { chunkOverlap: undefined } : { chunkOverlap: Math.trunc(Number(t)) },
                          );
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>similarityTopK</FieldLabel>
                      <Input
                        value={
                          chatCfg.ragOptions?.similarityTopK != null
                            ? String(chatCfg.ragOptions.similarityTopK)
                            : ""
                        }
                        onChange={(e) => {
                          const t = e.target.value.trim();
                          updateChatRag(
                            t === ""
                              ? { similarityTopK: undefined }
                              : { similarityTopK: Math.trunc(Number(t)) },
                          );
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>rerankTopN</FieldLabel>
                      <Input
                        value={
                          chatCfg.ragOptions?.rerankTopN != null ? String(chatCfg.ragOptions.rerankTopN) : ""
                        }
                        onChange={(e) => {
                          const t = e.target.value.trim();
                          updateChatRag(
                            t === "" ? { rerankTopN: undefined } : { rerankTopN: Math.trunc(Number(t)) },
                          );
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>retrievalMode</FieldLabel>
                      <Select
                        value={chatCfg.ragOptions?.retrievalMode ?? "__inherit__"}
                        onValueChange={(v) =>
                          updateChatRag({
                            retrievalMode: v === "__inherit__" ? undefined : (v as "hybrid" | "vector_only"),
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__inherit__">继承</SelectItem>
                          <SelectItem value="hybrid">hybrid</SelectItem>
                          <SelectItem value="vector_only">vector_only</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field className="mt-3 flex flex-row items-center gap-2">
                    <Checkbox
                      checked={chatCfg.ragOptions?.useRerank !== false}
                      onCheckedChange={(v) => updateChatRag({ useRerank: v === true })}
                    />
                    <span className="text-sm">useRerank（关闭则跳过重排）</span>
                  </Field>
                </div>

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
          )}
        </div>
      </div>
    </div>
  );
}
