'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Database, Check } from 'lucide-react'
import type { Game } from '@/lib/types'
import { useExtractionTasks } from '@/hooks/use-game'

interface IndexPanelProps {
  game: Game
  onUpdate: () => void
}

export function IndexPanel({ game, onUpdate }: IndexPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { tasks } = useExtractionTasks(game.id)

  const indexTaskActive = tasks.some(
    t =>
      t.type === '建立索引' &&
      (t.status === 'pending' || t.status === 'running'),
  )

  const canBuildIndex =
    !!game.rulesMarkdown &&
    game.extractionStatus !== 'processing' &&
    !indexTaskActive

  const handleBuildIndex = async () => {
    setIsSubmitting(true)

    try {
      const res = await fetch(`/api/games/${game.id}/build-index`, {
        method: 'POST',
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || '提交建索引失败')
      }

      toast.success('建索引任务已提交，完成后将自动更新索引状态')
      onUpdate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交失败，请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const busy = isSubmitting || indexTaskActive

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          向量索引
        </CardTitle>
        <CardDescription>
          建立向量索引以启用规则问答。任务在规则引擎后台执行（嵌入、BM25、可选 rerank
          模型加载）；提交后即可离开本页，任务列表会显示进度。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {(game.isIndexed || game.indexBuilding) && (
            <div className="flex flex-wrap items-center gap-3">
              {game.indexBuilding ? (
                <Badge variant="outline">索引更新中</Badge>
              ) : (
                <Badge variant="default" className="bg-success text-success-foreground">
                  <Check className="mr-1 h-3 w-3" />
                  已建立索引
                </Badge>
              )}
              {game.indexId && (
                <span className="text-xs text-muted-foreground font-mono">
                  ID: {game.indexId}
                </span>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-1">
            <Button
              onClick={handleBuildIndex}
              disabled={!canBuildIndex || busy}
              variant={game.isIndexed || game.indexBuilding ? 'outline' : 'default'}
            >
              {busy ? (
                <>
                  <Spinner className="mr-2" />
                  {indexTaskActive ? '建索引进行中…' : '提交中…'}
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  {game.isIndexed || game.indexBuilding ? '重新建立索引' : '建立索引'}
                </>
              )}
            </Button>
            {!canBuildIndex && (
              <p className="text-sm text-muted-foreground">
                {!game.rulesMarkdown
                  ? '请先完成规则提取'
                  : game.extractionStatus === 'processing'
                    ? '规则正在提取中，请稍后再建索引'
                    : indexTaskActive
                      ? '已有建索引任务进行中'
                      : ''}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
