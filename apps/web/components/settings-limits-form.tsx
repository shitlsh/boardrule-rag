"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

type Limits = {
  maxImageBytes: number;
  maxPdfBytes: number;
  maxMultiImageFiles: number;
  maxPdfPages: number;
  maxGstoneImageUrls: number;
  pageRasterDpi: number;
  pageRasterMaxSide: number;
};

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

export function SettingsLimitsForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Limits | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error("读取失败");
        const data = (await res.json()) as Limits;
        if (!cancelled) setForm(data);
      } catch {
        if (!cancelled) toast.error("无法加载规则书限制设置");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key: keyof Limits, raw: string) => {
    const n = Number(raw);
    setForm((prev) => (prev ? { ...prev, [key]: Number.isFinite(n) ? n : prev[key] } : prev));
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { message?: string }).message || "保存失败");
      }
      setForm(data as Limits);
      toast.success("已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
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
        <CardTitle>规则书与分页限制</CardTitle>
        <CardDescription>
          与上传、集石解析、规则引擎分页（POST /extract/pages）共用。修改后对新上传生效；单张图片与 PDF
          大小、多图张数、分页页数、集石链接数及栅格参数均可在此调整。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>单张图片上限（字节）</FieldLabel>
            <Input
              type="number"
              min={1024 * 1024}
              step={1024}
              value={form.maxImageBytes}
              onChange={(e) => update("maxImageBytes", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">约 {formatBytes(form.maxImageBytes)}</p>
          </Field>
          <Field>
            <FieldLabel>单个 PDF 上限（字节）</FieldLabel>
            <Input
              type="number"
              min={1024 * 1024}
              step={1024}
              value={form.maxPdfBytes}
              onChange={(e) => update("maxPdfBytes", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">约 {formatBytes(form.maxPdfBytes)}</p>
          </Field>
          <Separator />
          <Field>
            <FieldLabel>多图模式最多张数</FieldLabel>
            <Input
              type="number"
              min={1}
              max={500}
              value={form.maxMultiImageFiles}
              onChange={(e) => update("maxMultiImageFiles", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>分页后总页数上限（PDF / 多图 / 集石保留页）</FieldLabel>
            <Input
              type="number"
              min={1}
              max={500}
              value={form.maxPdfPages}
              onChange={(e) => update("maxPdfPages", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>集石解析出的图片链接数上限</FieldLabel>
            <Input
              type="number"
              min={1}
              max={500}
              value={form.maxGstoneImageUrls}
              onChange={(e) => update("maxGstoneImageUrls", e.target.value)}
            />
          </Field>
          <Separator />
          <Field>
            <FieldLabel>PAGE_RASTER_DPI（规则引擎栅格 DPI）</FieldLabel>
            <Input
              type="number"
              min={72}
              max={600}
              value={form.pageRasterDpi}
              onChange={(e) => update("pageRasterDpi", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>PAGE_RASTER_MAX_SIDE（长边像素上限）</FieldLabel>
            <Input
              type="number"
              min={256}
              max={8192}
              value={form.pageRasterMaxSide}
              onChange={(e) => update("pageRasterMaxSide", e.target.value)}
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
            "保存设置"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
