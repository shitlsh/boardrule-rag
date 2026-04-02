import Link from "next/link";

import { ExtractionStatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export default async function GamesPage() {
  const games = await prisma.game.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { tasks: true } } },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">游戏</h1>
          <p className="text-sm text-muted-foreground">管理元数据、规则上传与异步提取任务。</p>
        </div>
        <Link
          href="/games/new"
          className={cn(
            "inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
            "hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          新建游戏
        </Link>
      </div>

      <section aria-labelledby="games-table-heading">
        <h2 id="games-table-heading" className="sr-only">
          游戏列表
        </h2>

        <div className="md:hidden space-y-3" role="list">
          {games.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无游戏，请先新建。</p>
          ) : (
            games.map((g) => (
              <article
                key={g.id}
                role="listitem"
                className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{g.name}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground break-all">{g.slug}</p>
                  </div>
                  <ExtractionStatusBadge status={g.extractionStatus} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <dt>版本</dt>
                    <dd className="font-mono text-foreground">{g.version}</dd>
                  </div>
                  <div>
                    <dt>任务数</dt>
                    <dd className="font-mono text-foreground">{g._count.tasks}</dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <Link
                    href={`/games/${g.id}`}
                    className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    打开详情
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="hidden md:block">
          <Table aria-label="游戏列表">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">名称</TableHead>
                <TableHead scope="col">Slug</TableHead>
                <TableHead scope="col">规则版本</TableHead>
                <TableHead scope="col">提取状态</TableHead>
                <TableHead scope="col">任务数</TableHead>
                <TableHead scope="col">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {games.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    暂无游戏，请先新建。
                  </TableCell>
                </TableRow>
              ) : (
                games.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="font-mono text-xs break-all">{g.slug}</TableCell>
                    <TableCell className="font-mono text-sm">{g.version}</TableCell>
                    <TableCell>
                      <ExtractionStatusBadge status={g.extractionStatus} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{g._count.tasks}</TableCell>
                    <TableCell>
                      <Link
                        href={`/games/${g.id}`}
                        className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm text-sm font-medium"
                      >
                        详情
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
