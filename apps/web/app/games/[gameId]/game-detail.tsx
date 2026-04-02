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
  tasks: GameDetailTask[];
};

export function GameDetail({ initialGame }: { initialGame: GameDetailModel }) {
  const [game, setGame] = useState(initialGame);
  const [file, setFile] = useState<File | null>(null);
  const [terminology, setTerminology] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setSubmitError("请选择规则书文件");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("gameId", game.id);
      form.append("file", file);
      if (terminology.trim()) {
        form.append("terminologyContext", terminology.trim());
      }
      const res = await fetch("/api/tasks", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string; task?: unknown };
      if (!res.ok) {
        throw new Error(body.error || `上传失败（${res.status}）`);
      }
      await reloadGame();
      setFile(null);
      setTerminology("");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/games" className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
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
            <CardDescription>与规则引擎任务对齐的字段，供轮询与排错。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">状态</span>
              <ExtractionStatusBadge status={game.extractionStatus} />
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
            <CardTitle>上传规则书</CardTitle>
            <CardDescription>文件会保存到本地 storage，并调用 RULE_ENGINE_URL 上的异步提取。</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <label htmlFor="rules-file" className="text-sm font-medium text-foreground">
                  规则书文件
                </label>
                <input
                  id="rules-file"
                  name="file"
                  type="file"
                  accept="application/pdf,image/*"
                  className="block w-full text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p id="rules-file-hint" className="text-xs text-muted-foreground">
                  支持 PDF 或图片；实际上传格式以规则引擎与 LlamaParse 为准。
                </p>
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
              <Button type="submit" disabled={submitting}>
                {submitting ? "提交中…" : "开始提取"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

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
                  <CardContent className="p-4 space-y-2 text-sm">
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
                      <p className="text-destructive text-xs break-words" role="alert">
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
                      <TableCell className="font-mono text-xs align-top break-all">{t.id}</TableCell>
                      <TableCell className="align-top">
                        <TaskStatusBadge status={t.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs align-top break-all">{t.jobId ?? "—"}</TableCell>
                      <TableCell className="align-top text-sm">{prog?.detail ?? "—"}</TableCell>
                      <TableCell className="align-top text-sm text-destructive break-words">
                        {t.errorMsg ?? "—"}
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted-foreground whitespace-nowrap">
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
