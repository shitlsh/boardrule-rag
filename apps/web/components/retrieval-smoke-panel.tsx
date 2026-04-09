"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import type { Game } from "@/lib/types";

interface SmokeSourceNode {
  score?: number | null;
  text_preview?: string | null;
  metadata?: {
    pages?: unknown;
    original_page_range?: unknown;
    source_file?: unknown;
    game_id?: unknown;
  };
}

interface SmokeRetrieveResponse {
  query?: string;
  similarity_top_k_override?: number | null;
  rerank_top_n_override?: number | null;
  node_count?: number;
  merged_context_chars?: number;
  source_nodes?: SmokeSourceNode[];
  message?: string;
}

interface RetrievalSmokePanelProps {
  game: Game;
}

export function RetrievalSmokePanel({ game }: RetrievalSmokePanelProps) {
  const [q, setQ] = useState("游戏中有哪些规则要点");
  const [similarityTopK, setSimilarityTopK] = useState("");
  const [rerankTopN, setRerankTopN] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SmokeRetrieveResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!game.isIndexed) return;
      try {
        const mr = await fetch(`/api/games/${game.id}/index-manifest`);
        if (!cancelled && mr.ok) {
          const j = (await mr.json()) as { manifest?: Record<string, unknown> | null };
          const m = j.manifest;
          if (m && typeof m === "object") {
            if (typeof m.similarity_top_k === "number") {
              setSimilarityTopK(String(m.similarity_top_k));
            }
            if (typeof m.rerank_top_n === "number") {
              setRerankTopN(String(m.rerank_top_n));
            }
          }
        }
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game.id, game.isIndexed]);

  const runSmoke = useCallback(async () => {
    const query = q.trim();
    if (!query) {
      toast.error("请输入检索问句");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const sp = new URLSearchParams();
      sp.set("q", query);
      const sk = similarityTopK.trim();
      const rn = rerankTopN.trim();
      if (sk !== "") sp.set("similarity_top_k", sk);
      if (rn !== "") sp.set("rerank_top_n", rn);

      const res = await fetch(`/api/games/${game.id}/smoke-retrieve?${sp.toString()}`);
      const data = (await res.json()) as SmokeRetrieveResponse;
      if (!res.ok) {
        throw new Error(data.message || `请求失败 ${res.status}`);
      }
      setResult(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "召回测试失败";
      toast.error(msg);
      setResult({ message: msg });
    } finally {
      setLoading(false);
    }
  }, [game.id, q, similarityTopK, rerankTopN]);

  const buildExportPayload = useCallback(() => {
    return {
      exportedAt: new Date().toISOString(),
      tool: "smoke-retrieve",
      game: {
        id: game.id,
        name: game.name,
        slug: game.slug,
      },
      request: {
        q: q.trim(),
        similarityTopK: similarityTopK.trim() || null,
        rerankTopN: rerankTopN.trim() || null,
      },
      response: result,
    };
  }, [game.id, game.name, game.slug, q, result, similarityTopK, rerankTopN]);

  const copyExport = useCallback(async () => {
    if (!result) return;
    const text = JSON.stringify(buildExportPayload(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制 JSON 到剪贴板");
    } catch {
      toast.error("复制失败，请改用下载");
    }
  }, [buildExportPayload, result]);

  const downloadExport = useCallback(() => {
    if (!result) return;
    const text = JSON.stringify(buildExportPayload(), null, 2);
    const safeSlug = game.slug.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 32) || "game";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smoke-retrieve_${game.id.slice(0, 12)}_${safeSlug}_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已下载 JSON 文件");
  }, [buildExportPayload, game.id, game.slug, result]);

  if (!game.isIndexed) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Search className="h-5 w-5" />
            召回测试
          </CardTitle>
          <CardDescription>建立向量索引后，可在此调试 hybrid + rerank 的召回结果（不调用大模型生成答案）。</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          召回测试
        </CardTitle>
        <CardDescription>
          调用规则引擎 <span className="font-mono">GET /index/…/smoke-retrieve</span>
          ，查看精排后的片段与分数。合并长度较大时，问答合成阶段可能仍只会使用前文一部分（见规则引擎文档）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field className="min-w-0 flex-1">
            <FieldLabel>检索问句</FieldLabel>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="例如：游戏中有哪些拍卖方式"
            />
          </Field>
          <Button type="button" onClick={() => void runSmoke()} disabled={loading}>
            {loading ? (
              <>
                <Spinner className="mr-2" />
                检索中…
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                运行
              </>
            )}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>召回 TOPK（可选，留空则用 manifest）</FieldLabel>
            <Input
              type="number"
              min={1}
              max={200}
              value={similarityTopK}
              onChange={(e) => setSimilarityTopK(e.target.value)}
              placeholder="默认 manifest"
            />
          </Field>
          <Field>
            <FieldLabel>精排条数（可选，留空则用 manifest）</FieldLabel>
            <Input
              type="number"
              min={1}
              max={100}
              value={rerankTopN}
              onChange={(e) => setRerankTopN(e.target.value)}
              placeholder="默认 manifest"
            />
          </Field>
        </div>

        {result && !result.message && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                {result.query != null && (
                  <span>
                    问句：<span className="text-foreground">{result.query}</span>
                  </span>
                )}
                {result.node_count != null && (
                  <span>
                    命中条数：<span className="font-mono text-foreground">{result.node_count}</span>
                  </span>
                )}
                {result.merged_context_chars != null && (
                  <span>
                    合并长度（字符）：<span className="font-mono text-foreground">{result.merged_context_chars}</span>
                  </span>
                )}
                {(result.similarity_top_k_override != null || result.rerank_top_n_override != null) && (
                  <span>
                    覆盖：top_k={String(result.similarity_top_k_override ?? "—")} / rerank_n=
                    {String(result.rerank_top_n_override ?? "—")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void copyExport()}>
                  <Copy className="mr-2 h-4 w-4" />
                  复制 JSON
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => downloadExport()}>
                  <Download className="mr-2 h-4 w-4" />
                  下载 JSON
                </Button>
              </div>
            </div>

            <ul className="space-y-3">
              {(result.source_nodes ?? []).map((node, i) => (
                <li
                  key={`${i}-${node.score ?? i}`}
                  className="rounded-md border bg-background p-3 shadow-xs"
                >
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">#{i + 1}</span>
                    {node.score != null && (
                      <span className="font-mono text-xs text-muted-foreground">score: {node.score}</span>
                    )}
                  </div>
                  <p className="mb-2 font-mono text-xs text-muted-foreground">
                    {formatMetaLine(node.metadata)}
                  </p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
                    {node.text_preview || "（无正文）"}
                  </pre>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result?.message && !result.source_nodes && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{result.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void copyExport()}>
                <Copy className="mr-2 h-4 w-4" />
                复制错误信息（JSON）
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => downloadExport()}>
                <Download className="mr-2 h-4 w-4" />
                下载 JSON
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatMetaLine(meta: SmokeSourceNode["metadata"] | undefined): string {
  if (!meta || typeof meta !== "object") return "";
  const parts: string[] = [];
  if (meta.pages != null) parts.push(`pages: ${String(meta.pages)}`);
  if (meta.original_page_range != null) parts.push(`range: ${String(meta.original_page_range)}`);
  if (meta.source_file != null) parts.push(`file: ${String(meta.source_file)}`);
  return parts.join(" · ") || "—";
}
