"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AiCredentialPublic, AiGatewayPublic } from "@/lib/ai-gateway-types";

type Props = {
  data: AiGatewayPublic;
  onUpdated: (next: AiGatewayPublic) => void;
};

export function ModelCredentialsPanel({ data, onUpdated }: Props) {
  const [alias, setAlias] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
          vendor: "gemini",
          alias: a,
          apiKey: k,
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
        <CardTitle className="text-lg">Gemini 凭证</CardTitle>
        <CardDescription>
          别名全局唯一（不区分大小写）。保存后的凭证可在下方槽位中选用；与模型配置互不影响，可随时添加或删除。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
          <p className="text-sm font-medium mb-3">添加新凭证</p>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
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
                placeholder="粘贴 Google AI Studio 密钥"
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
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 bg-card hover:bg-muted/20 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.alias}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {c.hasKey ? `密钥已配置 · 尾号 ${c.keyLast4 ?? "****"}` : "密钥无效或解密失败"}
                  </p>
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
