"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { AiGatewayPublic, SlotKey } from "@/lib/ai-gateway-types";

const SLOTS: { key: SlotKey; label: string; hint: string }[] = [
  { key: "flash", label: "Flash", hint: "目录、快路径、Flash 视觉" },
  { key: "pro", label: "Pro", hint: "章节提取、合并、Pro 视觉" },
  { key: "embed", label: "Embed", hint: "向量嵌入（建索引）" },
  { key: "chat", label: "Chat", hint: "规则问答（RAG）" },
];

type DraftCredential = {
  id: string;
  vendor: "gemini";
  alias: string;
  apiKey: string;
};

type Draft = {
  credentials: DraftCredential[];
  slotBindings: Record<SlotKey, { credentialId: string; model: string } | null>;
  chatOptions: { temperature: number; maxTokens: number };
};

function publicToDraft(p: AiGatewayPublic): Draft {
  return {
    credentials: p.credentials.map((c) => ({
      id: c.id,
      vendor: "gemini",
      alias: c.alias,
      apiKey: "",
    })),
    slotBindings: {
      flash: p.slotBindings.flash,
      pro: p.slotBindings.pro,
      embed: p.slotBindings.embed,
      chat: p.slotBindings.chat,
    },
    chatOptions: { ...p.chatOptions },
  };
}

export function SettingsAiGatewayForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [modelCache, setModelCache] = useState<Record<string, { name: string }[]>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/ai-gateway");
    if (!res.ok) {
      throw new Error("读取失败");
    }
    const data = (await res.json()) as AiGatewayPublic;
    setDraft(publicToDraft(data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch {
        if (!cancelled) toast.error("无法加载 AI Gateway 设置");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const fetchModelsFor = useCallback(async (credentialId: string) => {
    if (modelCache[credentialId]) return;
    const res = await fetch(`/api/ai/models?credentialId=${encodeURIComponent(credentialId)}`);
    const data = (await res.json()) as { models?: { name: string }[]; message?: string };
    if (!res.ok) {
      throw new Error(data.message || "拉取模型列表失败");
    }
    setModelCache((prev) => ({
      ...prev,
      [credentialId]: (data.models ?? []).map((m) => ({ name: m.name })),
    }));
  }, [modelCache]);

  const slotBindingKey = useMemo(
    () => (draft ? JSON.stringify(draft.slotBindings) : ""),
    [draft],
  );
  useEffect(() => {
    if (!draft) return;
    const ids = new Set<string>();
    for (const s of SLOTS) {
      const cid = draft.slotBindings[s.key]?.credentialId;
      if (cid) ids.add(cid);
    }
    for (const cid of ids) {
      fetchModelsFor(cid).catch(() => {
        /* 列表失败时仍可手动输入模型 */
      });
    }
  }, [draft, slotBindingKey, fetchModelsFor]);

  const addCredential = () => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        credentials: [
          ...d.credentials,
          { id: crypto.randomUUID(), vendor: "gemini", alias: "", apiKey: "" },
        ],
      };
    });
  };

  const removeCredential = (id: string) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        credentials: d.credentials.filter((c) => c.id !== id),
        slotBindings: {
          flash: d.slotBindings.flash?.credentialId === id ? null : d.slotBindings.flash,
          pro: d.slotBindings.pro?.credentialId === id ? null : d.slotBindings.pro,
          embed: d.slotBindings.embed?.credentialId === id ? null : d.slotBindings.embed,
          chat: d.slotBindings.chat?.credentialId === id ? null : d.slotBindings.chat,
        },
      };
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const credentials = draft.credentials.map((c) => ({
        id: c.id,
        vendor: "gemini" as const,
        alias: c.alias.trim(),
        ...(c.apiKey.trim() !== "" ? { apiKey: c.apiKey.trim() } : {}),
      }));
      const res = await fetch("/api/ai-gateway", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials,
          slotBindings: draft.slotBindings,
          chatOptions: draft.chatOptions,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { message?: string }).message || "保存失败");
      }
      await load();
      setModelCache({});
      toast.success("已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !draft) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Gateway（Gemini）</CardTitle>
        <CardDescription>
          先添加带别名的 API Key，再为 Flash / Pro / Embed / Chat 选择凭证与模型。别名全局唯一（不区分大小写）。修改嵌入模型后通常需重建索引。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">凭证（Gemini）</h3>
            <Button type="button" variant="outline" size="sm" onClick={addCredential}>
              添加凭证
            </Button>
          </div>
          {draft.credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无凭证，请先添加。</p>
          ) : (
            <div className="space-y-4">
              {draft.credentials.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-border p-4 space-y-3"
                >
                  <div className="flex flex-wrap gap-3 items-end">
                    <Field className="min-w-[200px] flex-1">
                      <FieldLabel>别名</FieldLabel>
                      <Input
                        value={c.alias}
                        onChange={(e) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  credentials: d.credentials.map((x) =>
                                    x.id === c.id ? { ...x, alias: e.target.value } : x,
                                  ),
                                }
                              : d,
                          )
                        }
                        placeholder="如 prod / personal"
                      />
                    </Field>
                    <Field className="min-w-[240px] flex-[2]">
                      <FieldLabel>API Key（留空表示保留原密钥）</FieldLabel>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        value={c.apiKey}
                        onChange={(e) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  credentials: d.credentials.map((x) =>
                                    x.id === c.id ? { ...x, apiKey: e.target.value } : x,
                                  ),
                                }
                              : d,
                          )
                        }
                        placeholder="••••••••"
                      />
                    </Field>
                    <Button type="button" variant="ghost" onClick={() => removeCredential(c.id)}>
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <FieldGroup className="gap-6">
          <h3 className="text-sm font-medium">模型槽位</h3>
          {SLOTS.map((s) => (
            <div key={s.key} className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">
                {s.label}
                <span className="text-muted-foreground font-normal"> — {s.hint}</span>
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Field className="min-w-[200px]">
                  <FieldLabel>凭证</FieldLabel>
                  <Select
                    value={draft.slotBindings[s.key]?.credentialId ?? "__none__"}
                    onValueChange={async (v) => {
                      const credentialId = v === "__none__" ? "" : v;
                      setDraft((d) => {
                        if (!d) return d;
                        return {
                          ...d,
                          slotBindings: {
                            ...d.slotBindings,
                            [s.key]:
                              credentialId === ""
                                ? null
                                : {
                                    credentialId,
                                    model: d.slotBindings[s.key]?.model ?? "",
                                  },
                          },
                        };
                      });
                      if (credentialId) {
                        try {
                          await fetchModelsFor(credentialId);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "拉取模型失败");
                        }
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择凭证" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">（未选择）</SelectItem>
                      {draft.credentials.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.alias.trim() || c.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="flex-1 min-w-0">
                  <FieldLabel>模型 ID</FieldLabel>
                  <Input
                    className="font-mono text-sm"
                    list={`slot-models-${s.key}`}
                    placeholder="选择凭证后可从下拉建议中选择，或直接输入"
                    value={draft.slotBindings[s.key]?.model ?? ""}
                    onChange={(e) => {
                      const model = e.target.value;
                      setDraft((d) => {
                        if (!d) return d;
                        const cur = d.slotBindings[s.key];
                        if (!cur?.credentialId) return d;
                        return {
                          ...d,
                          slotBindings: {
                            ...d.slotBindings,
                            [s.key]: { credentialId: cur.credentialId, model },
                          },
                        };
                      });
                    }}
                    disabled={!draft.slotBindings[s.key]?.credentialId}
                  />
                  <datalist id={`slot-models-${s.key}`}>
                    {(modelCache[draft.slotBindings[s.key]?.credentialId ?? ""] ?? []).map((m) => (
                      <option key={m.name} value={m.name} />
                    ))}
                  </datalist>
                </Field>
              </div>
            </div>
          ))}
        </FieldGroup>

        <Separator />

        <FieldGroup className="gap-4 max-w-md">
          <h3 className="text-sm font-medium">对话（Chat）参数</h3>
          <Field>
            <FieldLabel>Temperature</FieldLabel>
            <Input
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={draft.chatOptions.temperature}
              onChange={(e) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        chatOptions: {
                          ...d.chatOptions,
                          temperature: Number(e.target.value),
                        },
                      }
                    : d,
                )
              }
            />
          </Field>
          <Field>
            <FieldLabel>Max tokens</FieldLabel>
            <Input
              type="number"
              min={1}
              max={100000}
              step={1}
              value={draft.chatOptions.maxTokens}
              onChange={(e) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        chatOptions: {
                          ...d.chatOptions,
                          maxTokens: Number(e.target.value),
                        },
                      }
                    : d,
                )
              }
            />
          </Field>
        </FieldGroup>

        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Spinner className="mr-2" />
              保存中…
            </>
          ) : (
            "保存 AI 设置"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
