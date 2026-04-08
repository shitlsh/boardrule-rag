"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AiGatewayPublic } from "@/lib/ai-gateway-types";
import type { RagOptionsPatch } from "@/lib/ai-gateway";

type Props = {
  data: AiGatewayPublic;
  onUpdated: (next: AiGatewayPublic) => void;
};

export function ModelRagOptionsPanel({ data, onUpdated }: Props) {
  const ro = data.ragOptions ?? {};
  const [open, setOpen] = useState(false);
  const [rerankModel, setRerankModel] = useState(ro.rerankModel ?? "");
  const [chunkSize, setChunkSize] = useState(ro.chunkSize != null ? String(ro.chunkSize) : "");
  const [chunkOverlap, setChunkOverlap] = useState(ro.chunkOverlap != null ? String(ro.chunkOverlap) : "");
  const [bm25TokenProfile, setBm25TokenProfile] = useState<"" | "cjk_char" | "latin_word">(
    ro.bm25TokenProfile ?? "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const r = data.ragOptions ?? {};
    setRerankModel(r.rerankModel ?? "");
    setChunkSize(r.chunkSize != null ? String(r.chunkSize) : "");
    setChunkOverlap(r.chunkOverlap != null ? String(r.chunkOverlap) : "");
    setBm25TokenProfile(r.bm25TokenProfile ?? "");
  }, [data.ragOptions]);

  const flush = async () => {
    const patch: RagOptionsPatch = {};
    const prev = data.ragOptions ?? {};
    const r = rerankModel.trim();
    if (r !== (prev.rerankModel ?? "")) {
      patch.rerankModel = r || null;
    }
    if (chunkSize.trim() === "") {
      if (prev.chunkSize !== undefined) patch.chunkSize = null;
    } else {
      const n = Math.trunc(Number(chunkSize));
      if (!Number.isFinite(n) || n < 1) {
        toast.error("chunkSize 须为正整数");
        return;
      }
      if (n !== prev.chunkSize) patch.chunkSize = n;
    }
    if (chunkOverlap.trim() === "") {
      if (prev.chunkOverlap !== undefined) patch.chunkOverlap = null;
    } else {
      const n = Math.trunc(Number(chunkOverlap));
      if (!Number.isFinite(n) || n < 0) {
        toast.error("chunkOverlap 须为 ≥0 的整数");
        return;
      }
      if (n !== prev.chunkOverlap) patch.chunkOverlap = n;
    }
    const prof =
      bm25TokenProfile === "" ? undefined : bm25TokenProfile === "cjk_char" || bm25TokenProfile === "latin_word"
        ? bm25TokenProfile
        : undefined;
    if (prof !== prev.bm25TokenProfile) {
      patch.bm25TokenProfile = bm25TokenProfile === "" ? null : bm25TokenProfile;
    }
    if (Object.keys(patch).length === 0) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/ai-gateway/rag-options", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as AiGatewayPublic & { message?: string };
      if (!res.ok) {
        throw new Error(json.message || "保存失败");
      }
      onUpdated(json);
      toast.success("检索与索引参数已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none pb-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-lg">检索与索引</CardTitle>
                <CardDescription className="mt-1">
                  可选：覆盖规则引擎环境变量中的 Rerank、切块与 BM25 分词。留空则使用引擎默认（见 rule_engine
                  `.env`）。修改索引参数后需重建索引。
                </CardDescription>
              </div>
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="flex flex-col gap-4 max-w-2xl">
              <Field className="min-w-0">
                <FieldLabel>Rerank 模型（sentence-transformers）</FieldLabel>
                <Input
                  placeholder="默认：BAAI/bge-reranker-base"
                  value={rerankModel}
                  onChange={(e) => setRerankModel(e.target.value)}
                  onBlur={() => void flush()}
                  disabled={saving}
                />
              </Field>
              <div className="flex flex-col gap-4 sm:flex-row">
                <Field className="flex-1 min-w-0">
                  <FieldLabel>Chunk size（token）</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    placeholder="1024"
                    value={chunkSize}
                    onChange={(e) => setChunkSize(e.target.value)}
                    onBlur={() => void flush()}
                    disabled={saving}
                  />
                </Field>
                <Field className="flex-1 min-w-0">
                  <FieldLabel>Chunk overlap</FieldLabel>
                  <Input
                    type="number"
                    min={0}
                    placeholder="128"
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(e.target.value)}
                    onBlur={() => void flush()}
                    disabled={saving}
                  />
                </Field>
              </div>
              <Field className="min-w-0">
                <FieldLabel>BM25 分词配置</FieldLabel>
                <select
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  value={bm25TokenProfile}
                  onChange={(e) => {
                    const v = e.target.value as "" | "cjk_char" | "latin_word";
                    setBm25TokenProfile(v);
                    void (async () => {
                      const next = v === "" ? null : v;
                      const prev = data.ragOptions?.bm25TokenProfile;
                      if (next === (prev ?? null) || (next === null && prev === undefined)) {
                        return;
                      }
                      setSaving(true);
                      try {
                        const res = await fetch("/api/ai-gateway/rag-options", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ bm25TokenProfile: next }),
                        });
                        const json = (await res.json()) as AiGatewayPublic & { message?: string };
                        if (!res.ok) throw new Error(json.message || "保存失败");
                        onUpdated(json);
                        toast.success("检索与索引参数已保存");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "保存失败");
                      } finally {
                        setSaving(false);
                      }
                    })();
                  }}
                  disabled={saving}
                >
                  <option value="">默认（CJK 字级 + 英文词，推荐中文检索）</option>
                  <option value="cjk_char">cjk_char（显式指定，与默认相同）</option>
                  <option value="latin_word">latin_word（英文 `\b\w\w+\b` 词界）</option>
                </select>
              </Field>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
