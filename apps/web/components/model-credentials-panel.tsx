"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QwenEndpointPicker } from "@/components/qwen-endpoint-picker";
import type { AiCredentialPublic, AiGatewayPublic, AiVendor } from "@/lib/ai-gateway-types";
import {
  DASHSCOPE_COMPATIBLE_BASE_DEFAULT,
  normalizeDashscopeCompatibleBase,
} from "@/lib/dashscope-endpoint";

type Props = {
  data: AiGatewayPublic;
  onUpdated: (next: AiGatewayPublic) => void;
};

const VENDOR_LABEL: Record<AiVendor, string> = {
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  qwen: "阿里云百炼（Qwen）",
};

/** Short label for the closed select trigger (avoids overflow in narrow layouts). */
const VENDOR_TRIGGER_LABEL: Record<AiVendor, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  qwen: "Qwen",
};

export function ModelCredentialsPanel({ data, onUpdated }: Props) {
  const [alias, setAlias] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [vendor, setVendor] = useState<AiVendor>("gemini");
  const [qwenBase, setQwenBase] = useState(DASHSCOPE_COMPATIBLE_BASE_DEFAULT);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const prevVendorRef = useRef<AiVendor>(vendor);
  useEffect(() => {
    if (vendor === "qwen" && prevVendorRef.current !== "qwen") {
      setQwenBase(DASHSCOPE_COMPATIBLE_BASE_DEFAULT);
    }
    prevVendorRef.current = vendor;
  }, [vendor]);

  const add = async () => {
    const a = alias.trim();
    const k = apiKey.trim();
    if (!a) {
      toast.error("请填写别名");
      return;
    }
    if (!k) {
      toast.error("请填写 API Key");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/ai-gateway/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          vendor,
          alias: a,
          apiKey: k,
          ...(vendor === "qwen"
            ? { dashscopeCompatibleBase: normalizeDashscopeCompatibleBase(qwenBase) }
            : {}),
        }),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "添加失败");
      }
      onUpdated(json);
      setAlias("");
      setApiKey("");
      toast.success("凭证已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("确定删除此凭证？引用它的槽位将被清空。")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/ai-gateway/credentials/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "删除失败");
      }
      onUpdated(json);
      toast.success("已删除");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">API 凭证</CardTitle>
        <CardDescription>
          选择供应商并填写密钥。别名全局唯一（不区分大小写）。凭证可在下方槽位中复用；与具体模型 ID 分开配置，可随时增删。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
          <p className="text-sm font-medium mb-3">添加新凭证</p>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
            <Field className="min-w-0 flex-1 sm:max-w-[13rem] lg:max-w-[15rem]">
              <FieldLabel>供应商</FieldLabel>
              <Select value={vendor} onValueChange={(v) => setVendor(v as AiVendor)}>
                <SelectTrigger
                  className="w-full min-w-0 max-w-full"
                  title={`${VENDOR_TRIGGER_LABEL[vendor]} — ${VENDOR_LABEL[vendor]}`}
                >
                  <SelectValue>{VENDOR_TRIGGER_LABEL[vendor]}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-w-[min(100vw-2rem,22rem)]">
                  <SelectItem
                    value="gemini"
                    textValue="Gemini Google Gemini AI Studio Vertex"
                    className="items-start whitespace-normal py-2.5 pl-8 pr-2 [&>span]:whitespace-normal"
                  >
                    <span className="flex flex-col gap-1 text-left leading-snug">
                      <span className="font-medium">Gemini</span>
                      <span className="text-muted-foreground text-xs">
                        Google AI Studio / Vertex 等渠道的密钥
                      </span>
                    </span>
                  </SelectItem>
                  <SelectItem
                    value="openrouter"
                    textValue="OpenRouter"
                    className="items-start whitespace-normal py-2.5 pl-8 pr-2 [&>span]:whitespace-normal"
                  >
                    <span className="flex flex-col gap-1 text-left leading-snug">
                      <span className="font-medium">OpenRouter</span>
                      <span className="text-muted-foreground text-xs">openrouter.ai 控制台中的 API Key</span>
                    </span>
                  </SelectItem>
                  <SelectItem
                    value="qwen"
                    textValue="Qwen DashScope Bailian Alibaba"
                    className="items-start whitespace-normal py-2.5 pl-8 pr-2 [&>span]:whitespace-normal"
                  >
                    <span className="flex flex-col gap-1 text-left leading-snug">
                      <span className="font-medium">Qwen（百炼）</span>
                      <span className="text-muted-foreground text-xs">
                        阿里云大模型服务平台百炼 / DashScope 的 API Key（OpenAI 兼容接口）
                      </span>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {vendor === "qwen" ? (
              <div className="min-w-0 flex-[2] lg:max-w-md">
                <QwenEndpointPicker value={qwenBase} onChange={setQwenBase} disabled={adding} />
              </div>
            ) : null}
            <Field className="min-w-0 flex-1 lg:max-w-xs">
              <FieldLabel>别名</FieldLabel>
              <Input
                placeholder="例如 prod、personal"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field className="min-w-0 flex-[2]">
              <FieldLabel>API Key</FieldLabel>
              <Input
                type="password"
                placeholder={
                  vendor === "openrouter"
                    ? "粘贴 OpenRouter 控制台中的 API Key"
                    : vendor === "qwen"
                      ? "粘贴阿里云百炼（DashScope）API Key"
                      : "粘贴 Google AI Studio 或兼容渠道的密钥"
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Button type="button" className="shrink-0 lg:min-w-[9rem]" onClick={add} disabled={adding}>
              {adding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2">保存中…</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span className="ml-2">添加并保存</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {data.credentials.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">暂无已保存凭证。请先添加。</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
            {data.credentials.map((c: AiCredentialPublic) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between px-4 py-3 bg-card hover:bg-muted/20 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {c.alias}{" "}
                    <span className="text-muted-foreground font-normal text-xs">
                      （{VENDOR_LABEL[c.vendor]}）
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {c.hasKey ? `密钥已配置 · 尾号 ${c.keyLast4 ?? "****"}` : "密钥无效或解密失败"}
                  </p>
                  {c.vendor === "qwen" ? (
                    <SavedQwenEndpointEditor credential={c} onUpdated={onUpdated} />
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive shrink-0 self-start sm:self-center"
                  disabled={deletingId === c.id}
                  onClick={() => remove(c.id)}
                >
                  {deletingId === c.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  <span className="ml-1">删除</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SavedQwenEndpointEditor({
  credential,
  onUpdated,
}: {
  credential: AiCredentialPublic;
  onUpdated: (next: AiGatewayPublic) => void;
}) {
  const normalized = normalizeDashscopeCompatibleBase(credential.dashscopeCompatibleBase);
  const [base, setBase] = useState(normalized);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBase(normalizeDashscopeCompatibleBase(credential.dashscopeCompatibleBase));
  }, [credential.id, credential.dashscopeCompatibleBase]);

  const dirty = base !== normalizeDashscopeCompatibleBase(credential.dashscopeCompatibleBase);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ai-gateway/credentials/${encodeURIComponent(credential.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashscopeCompatibleBase: base }),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "保存失败");
      }
      onUpdated(json);
      toast.success("接入点已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3 max-w-xl">
      <QwenEndpointPicker value={base} onChange={setBase} disabled={saving} />
      <Button type="button" size="sm" variant="secondary" disabled={!dirty || saving} onClick={save}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        <span className={saving ? "ml-2" : ""}>保存接入点</span>
      </Button>
    </div>
  );
}
