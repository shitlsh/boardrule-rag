"use client";

import Link from "next/link";
import { Gamepad2, Image as ImageIcon, Lock, MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useGames } from "@/hooks/use-game";

export default function ChatListPage() {
  const { games, isLoading, isError } = useGames();

  const indexedGames = games.filter((g) => g.isIndexed);
  const pendingGames = games.filter((g) => !g.isIndexed);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">聊天预览</h1>
        <p className="text-muted-foreground">选择已建索引的游戏开始规则问答</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
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
            <EmptyDescription>请先在游戏列表中添加游戏并完成规则提取</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-8">
          {indexedGames.length > 0 ? (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
                <MessageCircle className="h-5 w-5 text-primary" />
                可用游戏
                <Badge variant="secondary" className="ml-2">
                  {indexedGames.length}
                </Badge>
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {indexedGames.map((game) => (
                  <Link key={game.id} href={`/chat/${game.id}`}>
                    <Card className="group h-full cursor-pointer transition-all hover:border-primary/50 hover:shadow-md">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          {game.coverUrl ? (
                            <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                              <img
                                src={game.coverUrl}
                                alt={game.name}
                                className="h-full w-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                              <Gamepad2 className="h-7 w-7 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <CardTitle className="truncate text-base transition-colors group-hover:text-primary">
                              {game.name}
                            </CardTitle>
                            <CardDescription className="truncate font-mono text-xs">{game.slug}</CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MessageCircle className="h-4 w-4 text-primary" />
                          <span>点击开始问答</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {pendingGames.length > 0 ? (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-muted-foreground">
                <Lock className="h-5 w-5" />
                待索引游戏
                <Badge variant="outline" className="ml-2">
                  {pendingGames.length}
                </Badge>
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pendingGames.map((game) => (
                  <Card key={game.id} className="h-full opacity-60">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        {game.coverUrl ? (
                          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-muted grayscale">
                            <img
                              src={game.coverUrl}
                              alt={game.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                            <ImageIcon className="h-7 w-7 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base">{game.name}</CardTitle>
                          <CardDescription className="truncate font-mono text-xs">{game.slug}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Lock className="h-4 w-4" />
                        <span>需先完成提取并建立索引</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
