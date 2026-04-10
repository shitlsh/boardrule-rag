"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { GeminiModelPicker } from "@/components/gemini-model-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiGatewayPublic, AiVendor, SlotKey } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

const SLOTS: { key: SlotKey; label: string; hint: string }[] = [
  {
    key: "flash",
    label: "Flash",
    hint: "目录、快路径与多模态读图；请选支持视觉的模型（Gemini 或 OpenRouter 上带多模态能力的模型）。",
  },
  {
    key: "pro",
    label: "Pro",
    hint: "章节提取、合并与高精度读图；模型需与供应商凭证匹配。",
  },
  {
    key: "embed",
    label: "Embed",
    hint: "向量嵌入与建索引；更换嵌入模型后通常需重建索引。OpenRouter 上请选嵌入类模型（如 text-embedding 系列）。",
  },
  {
    key: "chat",
    label: "Chat",
    hint: "RAG 合成回答；使用所选凭证对应的聊天模型。",
  },
];

function modelsCacheKey(credentialId: string, slot: SlotKey): string {
  return `${credentialId}:${slot}`;
}

function vendorShort(v: AiVendor): string {
  return v === "openrouter" ? "OpenRouter" : "Gemini";
}

type Props = {
  data: AiGatewayPublic;
  onUpdated: (next: AiGatewayPublic) => void;
};

export function ModelSlotsPanel({ data, onUpdated }: Props) {
  const [modelLists, setModelLists] = useState<Record<string, GeminiModelOption[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [savingSlot, setSavingSlot] = useState<SlotKey | null>(null);
  const [local, setLocal] = useState<Record<SlotKey, { credentialId: string; model: string }>>(() =>
    initLocal(data),
  );

  useEffect(() => {
    setLocal(initLocal(data));
  }, [data]);

  const fetchModels = useCallback(async (credentialId: string, slot: SlotKey) => {
    if (!credentialId) return;
    const k = modelsCacheKey(credentialId, slot);
    setLoadingModels((m) => ({ ...m, [k]: true }));
    try {
      const res = await fetch("/api/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId, slot }),
      });
      const json = (await res.json()) as { models?: GeminiModelOption[]; message?: string };
      if (!res.ok) {
        throw new Error(json.message || "拉取模型失败");
      }
      setModelLists((prev) => ({ ...prev, [k]: json.models ?? [] }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "拉取模型失败");
    } finally {
      setLoadingModels((m) => ({ ...m, [k]: false }));
    }
  }, []);

  const slotBindingsKey = JSON.stringify(data.slotBindings);

  /** Prefetch model lists for slots already saved on server (per credential + slot). */
  useEffect(() => {
    for (const s of SLOTS) {
      const b = data.slotBindings[s.key];
      if (b?.credentialId) {
        void fetchModels(b.credentialId, s.key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slotBindingsKey serializes data.slotBindings
  }, [slotBindingsKey, fetchModels]);

  const saveSlot = useCallback(
    async (slot: SlotKey, credentialId: string, model: string) => {
      setSavingSlot(slot);
      try {
        const res = await fetch(`/api/ai-gateway/slots/${encodeURIComponent(slot)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credentialId, model }),
        });
        const json = (await res.json()) as AiGatewayPublic & { message?: string };
        if (!res.ok) {
          throw new Error(json.message || "保存失败");
        }
        onUpdated(json);
        toast.success(`${SLOTS.find((x) => x.key === slot)?.label ?? slot} 已保存`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "保存失败");
      } finally {
        setSavingSlot(null);
      }
    },
    [onUpdated],
  );

  const clearSlot = async (slot: SlotKey) => {
    setSavingSlot(slot);
    try {
      const res = await fetch(`/api/ai-gateway/slots/${encodeURIComponent(slot)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "清除失败");
      }
      onUpdated(json);
      setLocal((prev) => ({
        ...prev,
        [slot]: { credentialId: "", model: "" },
      }));
      toast.success("已清除该槽位");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清除失败");
    } finally {
      setSavingSlot(null);
    }
  };

  const onCredentialChange = (slot: SlotKey, credentialId: string) => {
    const cid = credentialId === "__none__" ? "" : credentialId;

    if (!cid) {
      setLocal((prev) => ({ ...prev, [slot]: { credentialId: "", model: "" } }));
      void clearSlot(slot);
      return;
    }

    setLocal((prev) => ({
      ...prev,
      [slot]: {
        credentialId: cid,
        model: prev[slot].credentialId === cid ? prev[slot].model : "",
      },
    }));
    void fetchModels(cid, slot);
  };

  const onModelChange = (slot: SlotKey, model: string) => {
    setLocal((prev) => ({ ...prev, [slot]: { ...prev[slot], model } }));
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">模型槽位</CardTitle>
        <CardDescription>
          每个槽位绑定一组「凭证 + 模型 ID」。凭证决定供应商（Gemini 或 OpenRouter）；OpenRouter 模型 ID 多为「厂商/模型名」形式。变更嵌入（Embed）模型后通常需重建索引。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-1 xl:grid-cols-2">
          {SLOTS.map(({ key, label, hint }) => {
            const row = local[key];
            const ck = row.credentialId ? modelsCacheKey(row.credentialId, key) : "";
            const list = row.credentialId ? (modelLists[ck] ?? []) : [];
            const loading = row.credentialId ? Boolean(loadingModels[ck]) : false;
            const server = data.slotBindings[key];
            const dirty =
              row.credentialId !== (server?.credentialId ?? "") ||
              row.model.trim() !== (server?.model ?? "").trim();
            const modelAllowed = list.some((m) => m.name === row.model.trim());
            const canSave =
              Boolean(row.credentialId) &&
              Boolean(row.model.trim()) &&
              modelAllowed &&
              !loading &&
              list.length > 0;

            return (
              <div
                key={key}
                className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-foreground">{label}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
                  </div>
                  {savingSlot === key ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0 mt-0.5" />
                  ) : null}
                </div>

                <Field>
                  <FieldLabel>凭证</FieldLabel>
                  <Select
                    value={row.credentialId || "__none__"}
                    onValueChange={(v) => onCredentialChange(key, v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择已保存的凭证" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">未选择</SelectItem>
                      {data.credentials.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.alias}（{vendorShort(c.vendor)}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel className="flex items-center gap-2">
                    模型
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  </FieldLabel>
                  <GeminiModelPicker
                    slot={key}
                    vendor={
                      row.credentialId
                        ? (data.credentials.find((c) => c.id === row.credentialId)?.vendor ?? "gemini")
                        : "gemini"
                    }
                    models={list}
                    value={row.model}
                    onChange={(v) => onModelChange(key, v)}
                    loading={loading}
                    disabled={!row.credentialId}
                  />
                  {row.credentialId && !loading && list.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      未获取到可用模型，请检查凭证 API Key 或网络后重试。
                    </p>
                  ) : null}
                </Field>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    disabled={!canSave || !dirty || savingSlot !== null}
                    onClick={() => void saveSlot(key, row.credentialId.trim(), row.model.trim())}
                  >
                    保存
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      (!data.slotBindings[key] && !row.credentialId && !row.model) ||
                      savingSlot !== null
                    }
                    onClick={() => void clearSlot(key)}
                  >
                    清除此槽位
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function initLocal(data: AiGatewayPublic): Record<SlotKey, { credentialId: string; model: string }> {
  const out = {} as Record<SlotKey, { credentialId: string; model: string }>;
  for (const s of SLOTS) {
    const b = data.slotBindings[s.key];
    out[s.key] = {
      credentialId: b?.credentialId ?? "",
      model: b?.model ?? "",
    };
  }
  return out;
}
