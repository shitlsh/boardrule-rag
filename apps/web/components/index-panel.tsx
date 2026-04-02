'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Database, Check } from 'lucide-react'
import type { Game } from '@/lib/types'

interface IndexPanelProps {
  game: Game
  onUpdate: () => void
}

export function IndexPanel({ game, onUpdate }: IndexPanelProps) {
  const [isBuilding, setIsBuilding] = useState(false)

  const canBuildIndex = !!game.rulesMarkdown && game.extractionStatus !== 'processing'

  const handleBuildIndex = async () => {
    setIsBuilding(true)

    try {
      const res = await fetch(`/api/games/${game.id}/index`, {
        method: 'POST',
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || '建立索引失败')
      }

      toast.success('索引建立成功')
      onUpdate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '建立索引失败，请重试')
    } finally {
      setIsBuilding(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          向量索引
        </CardTitle>
        <CardDescription>
          建立向量索引以启用规则问答功能
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          {game.isIndexed ? (
            <div className="flex items-center gap-3">
              <Badge variant="default" className="bg-success text-success-foreground">
                <Check className="mr-1 h-3 w-3" />
                已建立索引
              </Badge>
              {game.indexId && (
                <span className="text-xs text-muted-foreground font-mono">
                  ID: {game.indexId}
                </span>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Button
                onClick={handleBuildIndex}
                disabled={!canBuildIndex || isBuilding}
              >
                {isBuilding ? (
                  <>
                    <Spinner className="mr-2" />
                    建立中...
                  </>
                ) : (
                  <>
                    <Database className="mr-2 h-4 w-4" />
                    建立索引
                  </>
                )}
              </Button>
              {!canBuildIndex && (
                <p className="text-sm text-muted-foreground">
                  {!game.rulesMarkdown
                    ? '请先完成规则提取'
                    : '正在处理中，请稍后'}
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
