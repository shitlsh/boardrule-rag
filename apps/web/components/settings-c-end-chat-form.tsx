"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { CEndChatLimitsPublic } from "@/lib/c-end-chat-settings";

type FormState = {
  dailyChatLimitPerIp: number;
  dailyChatLimitGlobal: number;
};

export function SettingsCEndChatForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({
    dailyChatLimitPerIp: 20,
    dailyChatLimitGlobal: 1000,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/c-end-chat");
        if (!res.ok) throw new Error("读取失败");
        const data = (await res.json()) as CEndChatLimitsPublic;
        if (!cancelled) {
          setForm({
            dailyChatLimitPerIp: data.dailyChatLimitPerIp,
            dailyChatLimitGlobal: data.dailyChatLimitGlobal,
          });
        }
      } catch {
        if (!cancelled) toast.error("无法加载 C 端对话限额");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/c-end-chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyChatLimitPerIp: form.dailyChatLimitPerIp,
          dailyChatLimitGlobal: form.dailyChatLimitGlobal,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { message?: string }).message || "保存失败");
      }
      const updated = data as CEndChatLimitsPublic;
      setForm({
        dailyChatLimitPerIp: updated.dailyChatLimitPerIp,
        dailyChatLimitGlobal: updated.dailyChatLimitGlobal,
      });
      toast.success("已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          C 端对话限额
        </CardTitle>
        <CardDescription>
          适用于 H5 与微信小程序等使用 miniapp 令牌的对话接口（按客户端 IP 计数全站合计）。0
          表示不限制。全站总量用于防止 C 端请求超出预算。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>每个 IP 每日对话上限</FieldLabel>
            <Input
              type="number"
              min={0}
              step={1}
              value={form.dailyChatLimitPerIp}
              onChange={(e) => {
                const n = Math.max(0, Math.trunc(Number(e.target.value)));
                setForm((prev) => ({
                  ...prev,
                  dailyChatLimitPerIp: Number.isFinite(n) ? n : prev.dailyChatLimitPerIp,
                }));
              }}
            />
            <p className="text-xs text-muted-foreground">
              {form.dailyChatLimitPerIp === 0
                ? "每个 IP 不限制次数"
                : `每个公网 IP 每自然日（UTC）最多 ${form.dailyChatLimitPerIp} 次对话`}
            </p>
          </Field>
          <Separator />
          <Field>
            <FieldLabel>全站每日对话总量上限</FieldLabel>
            <Input
              type="number"
              min={0}
              step={1}
              value={form.dailyChatLimitGlobal}
              onChange={(e) => {
                const n = Math.max(0, Math.trunc(Number(e.target.value)));
                setForm((prev) => ({
                  ...prev,
                  dailyChatLimitGlobal: Number.isFinite(n) ? n : prev.dailyChatLimitGlobal,
                }));
              }}
            />
            <p className="text-xs text-muted-foreground">
              {form.dailyChatLimitGlobal === 0
                ? "全站不限制总次数"
                : `所有 C 端用户合计每自然日（UTC）最多 ${form.dailyChatLimitGlobal} 次对话（默认 1000）`}
            </p>
          </Field>
        </FieldGroup>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Spinner className="mr-2" />
              保存中…
            </>
          ) : (
            "保存对话限额"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
