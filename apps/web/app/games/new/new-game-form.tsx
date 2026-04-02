"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function NewGameForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          coverUrl: coverUrl.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; game?: { id: string } };
      if (!res.ok) {
        throw new Error(body.error || `创建失败（${res.status}）`);
      }
      if (!body.game?.id) {
        throw new Error("响应缺少 game.id");
      }
      router.push(`/games/${body.game.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>新建游戏</CardTitle>
        <CardDescription>创建后将进入该游戏的详情页，可上传规则书并触发提取。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label htmlFor="game-name" className="text-sm font-medium text-foreground">
              名称 <span className="text-destructive">*</span>
            </label>
            <input
              id="game-name"
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="cover-url" className="text-sm font-medium text-foreground">
              封面 URL（可选）
            </label>
            <input
              id="cover-url"
              name="coverUrl"
              type="url"
              inputMode="url"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="https://"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button type="submit" disabled={submitting}>
              {submitting ? "创建中…" : "创建"}
            </Button>
            <Link
              href="/games"
              className={cn(
                "text-sm text-muted-foreground hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
              )}
            >
              取消
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
