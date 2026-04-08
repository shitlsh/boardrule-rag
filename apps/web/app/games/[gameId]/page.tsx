"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Image as ImageIcon, MessageCircle } from "lucide-react";

import { ExtractionPanel } from "@/components/extraction-panel";
import { IndexPanel } from "@/components/index-panel";
import { RulesPreview } from "@/components/rules-preview";
import { ExtractionStatusBadge, IndexStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGame } from "@/hooks/use-game";

export default function GameDetailPage() {
  const params = useParams<{ gameId: string }>();
  const gameId = typeof params?.gameId === "string" ? params.gameId : "";
  const { game, isLoading, isError, mutate } = useGame(gameId);

  if (!gameId) {
    return null;
  }

  if (isLoading) {
    return <GameDetailSkeleton />;
  }

  if (isError || !game) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/games">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold text-destructive">
            {isError ? "加载失败" : "游戏不存在"}
          </h1>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild className="mt-1">
          <Link href="/games">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            {game.coverUrl ? (
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                <img src={game.coverUrl} alt={game.name} className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-muted">
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{game.name}</h1>
              <p className="font-mono text-sm text-muted-foreground">{game.slug}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ExtractionStatusBadge status={game.extractionStatus} />
            <IndexStatusBadge isIndexed={game.isIndexed} indexBuilding={game.indexBuilding} />
            {game.isIndexed ? (
              <Button variant="outline" size="sm" asChild className="ml-2">
                <Link href={`/chat/${game.id}`}>
                  <MessageCircle className="mr-2 h-4 w-4" />
                  进入问答
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="max-w-4xl space-y-6">
        <ExtractionPanel game={game} onUpdate={mutate} />
        <RulesPreview game={game} onRefresh={mutate} />
        <IndexPanel game={game} onUpdate={mutate} />
      </div>
    </div>
  );
}

function GameDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-md" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="max-w-4xl space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
