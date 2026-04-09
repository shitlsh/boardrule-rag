"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { WechatConfigPublic } from "@/lib/wechat-settings";

type FormState = {
  appId: string;
  appSecret: string; // empty = keep existing
};

export function SettingsWechatForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [remote, setRemote] = useState<WechatConfigPublic | null>(null);
  const [form, setForm] = useState<FormState>({ appId: "", appSecret: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/wechat");
        if (!res.ok) throw new Error("读取失败");
        const data = (await res.json()) as WechatConfigPublic;
        if (!cancelled) {
          setRemote(data);
          setForm({ appId: data.appId, appSecret: "" });
        }
      } catch {
        if (!cancelled) toast.error("无法加载微信小程序设置");
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
      const body: Record<string, unknown> = {
        appId: form.appId.trim(),
      };
      if (form.appSecret.trim() !== "") {
        body.appSecret = form.appSecret.trim();
      }

      const res = await fetch("/api/settings/wechat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { message?: string }).message || "保存失败");
      }
      const updated = data as WechatConfigPublic;
      setRemote(updated);
      setForm((prev) => ({ ...prev, appSecret: "" }));
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
        <CardTitle>微信小程序</CardTitle>
        <CardDescription>
          配置微信小程序的 AppID 与 AppSecret，用于 <code className="text-xs">uni.login</code>{" "}
          换取用户 openid（<code className="text-xs">jscode2session</code>）。AppSecret 加密存储，保存后不再明文显示。C
          端对话次数上限请见「C 端对话限额」。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>AppID</FieldLabel>
            <Input
              value={form.appId}
              onChange={(e) => setForm((prev) => ({ ...prev, appId: e.target.value }))}
              placeholder="wx1234567890abcdef"
              autoComplete="off"
            />
          </Field>
          <Field>
            <FieldLabel>AppSecret（留空保留原密钥）</FieldLabel>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.appSecret}
              onChange={(e) => setForm((prev) => ({ ...prev, appSecret: e.target.value }))}
              placeholder={
                remote?.hasSecret
                  ? `已设置（末四位：${remote.secretLast4 ?? "****"}）`
                  : "尚未设置"
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
            "保存微信设置"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
