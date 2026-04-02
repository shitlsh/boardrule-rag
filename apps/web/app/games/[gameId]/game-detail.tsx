"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ExtractionStatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseProgressJson } from "@/lib/progress";

export type GameDetailTask = {
  id: string;
  status: string;
  jobId: string | null;
  errorMsg: string | null;
  progressJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GameDetailModel = {
  id: string;
  name: string;
  slug: string;
  version: number;
  extractionStatus: string | null;
  extractionJobId: string | null;
  lastCheckpointId: string | null;
  rulesMarkdownPath: string | null;
  quickStartGuidePath: string | null;
  startQuestionsPath: string | null;
  indexId: string | null;
  vectorStoreId: string | null;
  tasks: GameDetailTask[];
};

export function GameDetail({ initialGame }: { initialGame: GameDetailModel }) {
  const [game, setGame] = useState(initialGame);
  const [file, setFile] = useState<File | null>(null);
  const [terminology, setTerminology] = useState("");
  const [prepareSubmitting, setPrepareSubmitting] = useState(false);
  const [extractSubmitting, setExtractSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [pageJobId, setPageJobId] = useState<string | null>(null);
  const [pageUrls, setPageUrls] = useState<{ page: number; url: string }[]>([]);
  const [tocInput, setTocInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");

  const [rulesPreview, setRulesPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [buildIndexLoading, setBuildIndexLoading] = useState(false);

  const activeTaskIds = useMemo(
    () =>
      game.tasks
        .filter((t) => t.status === "PENDING" || t.status === "PROCESSING")
        .map((t) => t.id),
    [game.tasks],
  );

  const reloadGame = useCallback(async () => {
    const res = await fetch(`/api/games/${game.id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { game: GameDetailModel };
    setGame(data.game);
  }, [game.id]);

  const loadRulesPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/games/${game.id}/rules`, { cache: "no-store" });
      const data = (await res.json()) as { markdown?: string | null };
      setRulesPreview(data.markdown ?? null);
    } finally {
      setPreviewLoading(false);
    }
  }, [game.id]);

  const refreshTask = useCallback(
    async (taskId: string) => {
      const res = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        task: GameDetailTask & {
          game?: Partial<GameDetailModel> & { id: string };
        };
      };
      const t = data.task;
      setGame((g) => ({
        ...g,
        ...(t.game
          ? {
              version: t.game.version ?? g.version,
              extractionStatus: t.game.extractionStatus ?? g.extractionStatus,
              extractionJobId: t.game.extractionJobId ?? g.extractionJobId,
              lastCheckpointId: t.game.lastCheckpointId ?? g.lastCheckpointId,
              rulesMarkdownPath: t.game.rulesMarkdownPath ?? g.rulesMarkdownPath,
              quickStartGuidePath: t.game.quickStartGuidePath ?? g.quickStartGuidePath,
              startQuestionsPath: t.game.startQuestionsPath ?? g.startQuestionsPath,
              indexId: t.game.indexId ?? g.indexId,
              vectorStoreId: t.game.vectorStoreId ?? g.vectorStoreId,
            }
          : {}),
        tasks: g.tasks.map((row) =>
          row.id === t.id
            ? {
                id: t.id,
                status: t.status,
                jobId: t.jobId,
                errorMsg: t.errorMsg,
                progressJson: t.progressJson,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
              }
            : row,
        ),
      }));
    },
    [],
  );

  useEffect(() => {
    if (activeTaskIds.length === 0) return;
    const run = () => {
      void Promise.all(activeTaskIds.map((id) => refreshTask(id)));
    };
    run();
    const iv = setInterval(run, 3500);
    return () => clearInterval(iv);
  }, [activeTaskIds, refreshTask]);

  useEffect(() => {
    if (game.extractionStatus === "COMPLETED" && game.rulesMarkdownPath) {
      void loadRulesPreview();
    }
  }, [game.extractionStatus, game.rulesMarkdownPath, loadRulesPreview]);

  async function onPrepare(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setSubmitError("请选择规则书文件");
      return;
    }
    setSubmitError(null);
    setPrepareSubmitting(true);
    try {
      const form = new FormData();
      form.append("gameId", game.id);
      form.append("file", file);
      const res = await fetch("/api/extract/pages", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        job_id?: string;
        pages?: { page: number; url: string }[];
      };
      if (!res.ok) {
        throw new Error(body.error || `分页失败（${res.status}）`);
      }
      setPageJobId(body.job_id ?? null);
      setPageUrls(body.pages ?? []);
      setSubmitError(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setPrepareSubmitting(false);
    }
  }

  async function onExtract(e: React.FormEvent) {
    e.preventDefault();
    if (!pageJobId) {
      setSubmitError("请先上传并完成分页（生成缩略图）");
      return;
    }
    setSubmitError(null);
    setExtractSubmitting(true);
    try {
      const form = new FormData();
      form.append("gameId", game.id);
      form.append("pageJobId", pageJobId);
      form.append("tocPageIndices", tocInput.trim() || "[]");
      form.append("excludePageIndices", excludeInput.trim() || "[]");
      if (terminology.trim()) {
        form.append("terminologyContext", terminology.trim());
      }
      const res = await fetch("/api/tasks", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string; task?: unknown };
      if (!res.ok) {
        throw new Error(body.error || `提交失败（${res.status}）`);
      }
      await reloadGame();
      setFile(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtractSubmitting(false);
    }
  }

  async function onBuildIndex() {
    setBuildIndexLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/games/${game.id}/build-index`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error || `建索引失败（${res.status}）`);
      }
      await reloadGame();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuildIndexLoading(false);
    }
  }

  const indexed = Boolean(game.indexId || game.vectorStoreId);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          <Link
            href="/games"
            className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            游戏列表
          </Link>
          <span aria-hidden="true" className="px-2">
            /
          </span>
          <span className="text-foreground">{game.name}</span>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{game.name}</h1>
        <p className="text-sm text-muted-foreground">
          标识 <span className="font-mono text-foreground">{game.slug}</span> · 规则版本{" "}
          <span className="font-mono text-foreground">{game.version}</span>
        </p>
      </div>

      <section aria-labelledby="extraction-heading" className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle id="extraction-heading">提取状态</CardTitle>
            <CardDescription>异步任务与索引状态。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">状态</span>
              <ExtractionStatusBadge status={game.extractionStatus} />
            </div>
            <div>
              <span className="text-muted-foreground">索引</span>
              <p className="mt-1 text-foreground">
                {indexed ? (
                  <span className="font-mono text-xs break-all">{game.indexId ?? game.vectorStoreId}</span>
                ) : (
                  <span className="text-muted-foreground">未建立</span>
                )}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">extractionJobId</span>
              <p className="mt-1 break-all font-mono text-xs text-foreground">
                {game.extractionJobId ?? <span className="text-muted-foreground">—</span>}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">lastCheckpointId</span>
              <p className="mt-1 break-all font-mono text-xs text-foreground">
                {game.lastCheckpointId ?? <span className="text-muted-foreground">—</span>}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">导出路径</span>
              <p className="mt-1 break-all font-mono text-xs text-foreground">
                {game.rulesMarkdownPath ?? <span className="text-muted-foreground">尚未生成</span>}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>规则书分页与提取</CardTitle>
            <CardDescription>
              先上传并分页（生成页图），再填写目录页与排除页后开始抽取。需要本机已安装 poppler（见 QUICKSTART）。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form className="space-y-4" onSubmit={onPrepare}>
              <div className="space-y-2">
                <label htmlFor="rules-file" className="text-sm font-medium text-foreground">
                  1. 规则书文件（PDF 或有序图片）
                </label>
                <input
                  id="rules-file"
                  name="file"
                  type="file"
                  accept="application/pdf,image/*"
                  className="block w-full text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button type="submit" disabled={prepareSubmitting}>
                {prepareSubmitting ? "分页中…" : "上传并分页"}
              </Button>
            </form>

            {pageUrls.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">页缩略图（{pageUrls.length} 页）</p>
                <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-md border border-border p-2">
                  {pageUrls.map((p) => (
                    <div key={p.page} className="flex flex-col items-center gap-1 text-xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt={`第 ${p.page} 页`}
                        className="h-24 w-auto max-w-[6rem] rounded border border-border object-contain"
                      />
                      <span className="text-muted-foreground">P{p.page}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <form className="space-y-4 border-t border-border pt-4" onSubmit={onExtract}>
              <div className="space-y-2">
                <label htmlFor="toc-pages" className="text-sm font-medium text-foreground">
                  2. 目录页（物理页码，逗号分隔；留空则默认仅第 1 页为目录）
                </label>
                <input
                  id="toc-pages"
                  name="tocPageIndices"
                  type="text"
                  value={tocInput}
                  onChange={(e) => setTocInput(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="例如：2,3"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="exclude-pages" className="text-sm font-medium text-foreground">
                  排除页（封面/广告，不参与正文）
                </label>
                <input
                  id="exclude-pages"
                  name="excludePageIndices"
                  type="text"
                  value={excludeInput}
                  onChange={(e) => setExcludeInput(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="例如：1"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="terminology" className="text-sm font-medium text-foreground">
                  术语上下文（可选）
                </label>
                <textarea
                  id="terminology"
                  name="terminologyContext"
                  rows={3}
                  value={terminology}
                  onChange={(e) => setTerminology(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="例如：通用桌游术语，用于辅助模型理解"
                />
              </div>
              {submitError ? (
                <p className="text-sm text-destructive" role="alert">
                  {submitError}
                </p>
              ) : null}
              <Button type="submit" disabled={extractSubmitting || !pageJobId}>
                {extractSubmitting ? "提交中…" : "开始提取"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      {game.rulesMarkdownPath ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>规则正文预览</CardTitle>
              <CardDescription>提取完成后的 Markdown（只读）。</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadRulesPreview()} disabled={previewLoading}>
                {previewLoading ? "加载中…" : "刷新预览"}
              </Button>
              <Button type="button" size="sm" onClick={() => void onBuildIndex()} disabled={buildIndexLoading}>
                {buildIndexLoading ? "建索引中…" : "建立索引"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {rulesPreview ? (
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 text-xs text-foreground">
                {rulesPreview}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">{previewLoading ? "加载中…" : "点击「刷新预览」加载正文。"}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="tasks-heading">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="tasks-heading" className="text-lg font-semibold text-foreground">
              任务
            </h2>
            <p className="text-sm text-muted-foreground">异步任务列表；处理中会自动轮询刷新。</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void reloadGame()}>
            刷新
          </Button>
        </div>

        <div className="md:hidden space-y-3" role="list">
          {game.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无任务。</p>
          ) : (
            game.tasks.map((t) => {
              const prog = parseProgressJson(t.progressJson);
              return (
                <Card key={t.id} role="listitem">
                  <CardContent className="space-y-2 p-4 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground break-all">{t.id}</span>
                      <TaskStatusBadge status={t.status} />
                    </div>
                    <div>
                      <span className="text-muted-foreground">jobId</span>
                      <p className="font-mono text-xs break-all">{t.jobId ?? "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">进度</span>
                      <p className="text-foreground">{prog?.detail ?? "—"}</p>
                    </div>
                    {t.errorMsg ? (
                      <p className="text-xs break-words text-destructive" role="alert">
                        {t.errorMsg}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <div className="hidden md:block">
          <Table aria-label="提取任务列表">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">任务 ID</TableHead>
                <TableHead scope="col">状态</TableHead>
                <TableHead scope="col">extractionJobId</TableHead>
                <TableHead scope="col">进度</TableHead>
                <TableHead scope="col">错误</TableHead>
                <TableHead scope="col">更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {game.tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    暂无任务。
                  </TableCell>
                </TableRow>
              ) : (
                game.tasks.map((t) => {
                  const prog = parseProgressJson(t.progressJson);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="break-all font-mono text-xs align-top">{t.id}</TableCell>
                      <TableCell className="align-top">
                        <TaskStatusBadge status={t.status} />
                      </TableCell>
                      <TableCell className="break-all font-mono text-xs align-top">{t.jobId ?? "—"}</TableCell>
                      <TableCell className="align-top text-sm">{prog?.detail ?? "—"}</TableCell>
                      <TableCell className="align-top text-sm text-destructive break-words">{t.errorMsg ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">
                        {new Date(t.updatedAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
