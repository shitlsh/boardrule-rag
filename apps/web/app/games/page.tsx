"use client";

import Link from "next/link";
import { ExternalLink, Gamepad2, Plus } from "lucide-react";

import { ExtractionStatusBadge, IndexStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGames } from "@/hooks/use-game";

export default function GamesPage() {
  const { games, isLoading, isError } = useGames();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">游戏列表</h1>
          <p className="text-muted-foreground">管理桌游规则书提取与索引</p>
        </div>
        <Button asChild>
          <Link href="/games/new">
            <Plus className="mr-2 h-4 w-4" />
            新建游戏
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>所有游戏</CardTitle>
          <CardDescription>查看和管理已添加的桌游</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="py-8 text-center text-destructive">加载失败，请刷新页面重试</div>
          ) : games.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Gamepad2 />
                </EmptyMedia>
                <EmptyTitle>暂无游戏</EmptyTitle>
                <EmptyDescription>点击右上角按钮添加你的第一个桌游</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>提取状态</TableHead>
                  <TableHead>索引状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {games.map((game) => (
                  <TableRow key={game.id}>
                    <TableCell className="font-medium">{game.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{game.slug}</TableCell>
                    <TableCell>
                      <ExtractionStatusBadge status={game.extractionStatus} />
                    </TableCell>
                    <TableCell>
                      <IndexStatusBadge isIndexed={game.isIndexed} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/games/${game.id}`}>
                          查看详情
                          <ExternalLink className="ml-2 h-3 w-3" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
