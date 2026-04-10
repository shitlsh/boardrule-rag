"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { GeminiModelPicker } from "@/components/gemini-model-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiGatewayPublic, AiVendor, SlotKey } from "@/lib/ai-gateway-types";
import type { GeminiModelOption } from "@/lib/gemini-model-types";

type LocalSlotRow = {
  credentialId: string;
  model: string;
  /** flash / pro */
  maxOutputTokens: string;
  /** chat */
  temperature: string;
  maxTokens: string;
};

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
    hint: "向量嵌入与建索引；更换嵌入模型后通常需重建索引。OpenRouter / 百炼请选嵌入类模型（如 text-embedding 系列）。",
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
  if (v === "openrouter") return "OpenRouter";
  if (v === "qwen") return "Qwen";
  return "Gemini";
}

type Props = {
  data: AiGatewayPublic;
  onUpdated: (next: AiGatewayPublic) => void;
};

export function ModelSlotsPanel({ data, onUpdated }: Props) {
  const [modelLists, setModelLists] = useState<Record<string, GeminiModelOption[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [savingSlot, setSavingSlot] = useState<SlotKey | null>(null);
  const [local, setLocal] = useState<Record<SlotKey, LocalSlotRow>>(() => initLocal(data));

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
    async (slot: SlotKey) => {
      const row = local[slot];
      setSavingSlot(slot);
      try {
        const body: Record<string, unknown> = {
          credentialId: row.credentialId.trim(),
          model: row.model.trim(),
        };
        if (slot === "flash" || slot === "pro") {
          const raw = row.maxOutputTokens.trim();
          body.maxOutputTokens = raw === "" ? null : Number(raw);
          if (raw !== "" && !Number.isFinite(body.maxOutputTokens as number)) {
            throw new Error("maxOutputTokens 须为数字");
          }
          if (raw !== "" && (body.maxOutputTokens as number) < 1) {
            throw new Error("maxOutputTokens 须 ≥ 1，或留空使用引擎默认");
          }
        }
        if (slot === "chat") {
          body.temperature = Number(row.temperature);
          body.maxTokens = Number(row.maxTokens);
          if (!Number.isFinite(body.temperature as number)) throw new Error("temperature 无效");
          if (!Number.isFinite(body.maxTokens as number) || (body.maxTokens as number) < 1) {
            throw new Error("maxTokens 无效");
          }
        }
        const res = await fetch(`/api/ai-gateway/slots/${encodeURIComponent(slot)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
    [local, onUpdated],
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
        [slot]: emptyRow(data),
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
      setLocal((prev) => ({ ...prev, [slot]: emptyRow(data) }));
      void clearSlot(slot);
      return;
    }

    setLocal((prev) => ({
      ...prev,
      [slot]: {
        ...prev[slot],
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
          每个槽位绑定一组「凭证 + 模型 ID」及该槽位专用生成参数。Flash / Pro 可设置单次最大输出 token；Chat 可设置对话温度与回复长度。留空 max output 表示使用规则引擎默认（见部署环境变量）。变更嵌入（Embed）模型后通常需重建索引。
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
            const serverMaxOut =
              server?.maxOutputTokens != null ? String(server.maxOutputTokens) : "";
            const serverTemp =
              key === "chat"
                ? String(server?.temperature ?? data.chatOptions.temperature)
                : "";
            const serverChatMax =
              key === "chat" ? String(server?.maxTokens ?? data.chatOptions.maxTokens) : "";
            const dirty =
              row.credentialId !== (server?.credentialId ?? "") ||
              row.model.trim() !== (server?.model ?? "").trim() ||
              (key === "flash" || key === "pro"
                ? row.maxOutputTokens.trim() !== serverMaxOut
                : false) ||
              (key === "chat"
                ? row.temperature !== serverTemp || row.maxTokens !== serverChatMax
                : false);
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

                {key === "flash" || key === "pro" ? (
                  <Field>
                    <FieldLabel>单次最大输出（max output tokens）</FieldLabel>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="留空则使用引擎默认（如 32768）"
                      value={row.maxOutputTokens}
                      onChange={(e) =>
                        setLocal((prev) => ({
                          ...prev,
                          [key]: { ...prev[key], maxOutputTokens: e.target.value },
                        }))
                      }
                      disabled={!row.credentialId}
                    />
                    <FieldDescription>
                      规则书抽取与合并等长文生成会用到。需小于等于所选模型允许的上限。
                    </FieldDescription>
                  </Field>
                ) : null}

                {key === "chat" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>Temperature</FieldLabel>
                      <Input
                        type="number"
                        step={0.1}
                        min={0}
                        max={2}
                        value={row.temperature}
                        onChange={(e) =>
                          setLocal((prev) => ({
                            ...prev,
                            [key]: { ...prev[key], temperature: e.target.value },
                          }))
                        }
                        disabled={!row.credentialId}
                      />
                      <FieldDescription>RAG 合成回答的采样温度。</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel>Max tokens（回复）</FieldLabel>
                      <Input
                        type="number"
                        min={1}
                        max={200000}
                        step={1}
                        value={row.maxTokens}
                        onChange={(e) =>
                          setLocal((prev) => ({
                            ...prev,
                            [key]: { ...prev[key], maxTokens: e.target.value },
                          }))
                        }
                        disabled={!row.credentialId}
                      />
                    </Field>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    disabled={!canSave || !dirty || savingSlot !== null}
                    onClick={() => void saveSlot(key)}
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

function emptyRow(gateway: AiGatewayPublic): LocalSlotRow {
  return {
    credentialId: "",
    model: "",
    maxOutputTokens: "",
    temperature: String(gateway.chatOptions.temperature),
    maxTokens: String(gateway.chatOptions.maxTokens),
  };
}

function initLocal(data: AiGatewayPublic): Record<SlotKey, LocalSlotRow> {
  const out = {} as Record<SlotKey, LocalSlotRow>;
  for (const s of SLOTS) {
    const b = data.slotBindings[s.key];
    out[s.key] = {
      credentialId: b?.credentialId ?? "",
      model: b?.model ?? "",
      maxOutputTokens: b?.maxOutputTokens != null ? String(b.maxOutputTokens) : "",
      temperature: String(b?.temperature ?? data.chatOptions.temperature),
      maxTokens: String(b?.maxTokens ?? data.chatOptions.maxTokens),
    };
  }
  return out;
}
