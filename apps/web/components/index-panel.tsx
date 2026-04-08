'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { ChevronDown, Database, Check } from 'lucide-react'
import type { Game } from '@/lib/types'
import type { AiGatewayPublic } from '@/lib/ai-gateway-types'
import { useExtractionTasks } from '@/hooks/use-game'

interface IndexPanelProps {
  game: Game
  onUpdate: () => void
}

export function IndexPanel({ game, onUpdate }: IndexPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [advOpen, setAdvOpen] = useState(false)
  const [similarityTopK, setSimilarityTopK] = useState('8')
  const [rerankTopN, setRerankTopN] = useState('5')
  const [retrievalMode, setRetrievalMode] = useState<'hybrid' | 'vector_only'>('hybrid')
  const [useRerank, setUseRerank] = useState(true)
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

  useEffect(() => {
    let cancelled = false
    const applyGateway = (d: AiGatewayPublic) => {
      const ro = d.ragOptions ?? {}
      if (ro.similarityTopK != null) setSimilarityTopK(String(ro.similarityTopK))
      if (ro.rerankTopN != null) setRerankTopN(String(ro.rerankTopN))
      if (ro.retrievalMode === 'hybrid' || ro.retrievalMode === 'vector_only') {
        setRetrievalMode(ro.retrievalMode)
      }
      if (typeof ro.useRerank === 'boolean') setUseRerank(ro.useRerank)
    }

    ;(async () => {
      try {
        if (game.isIndexed) {
          const mr = await fetch(`/api/games/${game.id}/index-manifest`)
          if (!cancelled && mr.ok) {
            const j = (await mr.json()) as { manifest?: Record<string, unknown> | null }
            const m = j.manifest
            if (m && typeof m === 'object') {
              if (typeof m.similarity_top_k === 'number') {
                setSimilarityTopK(String(m.similarity_top_k))
              }
              if (typeof m.rerank_top_n === 'number') {
                setRerankTopN(String(m.rerank_top_n))
              }
              if (m.retrieval_mode === 'hybrid' || m.retrieval_mode === 'vector_only') {
                setRetrievalMode(m.retrieval_mode)
              }
              if (typeof m.use_rerank === 'boolean') {
                setUseRerank(m.use_rerank)
              }
              return
            }
          }
        }
        const res = await fetch('/api/ai-gateway')
        if (!res.ok || cancelled) return
        applyGateway((await res.json()) as AiGatewayPublic)
      } catch {
        /* keep field defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [game.id, game.isIndexed])

  const handleBuildIndex = useCallback(async () => {
    setIsSubmitting(true)

    try {
      const sk = Number.parseInt(similarityTopK, 10)
      const rn = Number.parseInt(rerankTopN, 10)
      const payload: Record<string, unknown> = {
        retrievalMode,
        useRerank,
      }
      if (Number.isFinite(sk) && sk > 0) payload.similarityTopK = sk
      if (Number.isFinite(rn) && rn > 0) payload.rerankTopN = rn

      const res = await fetch(`/api/games/${game.id}/build-index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
  }, [
    game.id,
    onUpdate,
    rerankTopN,
    retrievalMode,
    similarityTopK,
    useRerank,
  ])

  const busy = isSubmitting || indexTaskActive

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          向量索引
        </CardTitle>
        <CardDescription>
          建立向量索引以启用规则问答。展开「索引选项」可分别设置<strong className="font-medium text-foreground">召回</strong>
          与<strong className="font-medium text-foreground">精排</strong>
          。已建立索引时，下列选项会与规则引擎磁盘上的 <span className="font-mono">manifest.json</span>{' '}
          同步显示（非仅网关默认）。全局默认见「模型管理 → 检索与索引」。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Collapsible open={advOpen} onOpenChange={setAdvOpen} className="mb-4">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between rounded-md border border-dashed px-3 py-2 text-left text-sm"
            >
              <span>索引选项（可选）</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform ${advOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="flex max-w-xl flex-col gap-5">
              <p className="text-muted-foreground text-sm leading-relaxed">
                流水线是「先召回一批片段 → 再可选地精排」。下面第一项只决定<strong className="text-foreground">怎么召回</strong>
                （是否建 BM25）；第二项决定召回之后<strong className="text-foreground">要不要</strong>
                用 cross-encoder 重排，与是否混合检索<strong className="text-foreground">无强制绑定</strong>
                （例如：仅向量 + 开精排；或混合 + 关精排，都可以）。
              </p>

              <div className="flex flex-col gap-3">
                <p className="text-foreground text-sm font-medium">1. 召回：建什么索引、怎么取候选</p>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <Field className="flex-1 min-w-0">
                    <FieldLabel>召回 TOPK（相似度 / RRF 宽度）</FieldLabel>
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      value={similarityTopK}
                      onChange={e => setSimilarityTopK(e.target.value)}
                    />
                  </Field>
                </div>
                <Field className="min-w-0">
                  <FieldLabel>索引模式（召回路径）</FieldLabel>
                  <select
                    className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    value={retrievalMode}
                    onChange={e =>
                      setRetrievalMode(e.target.value === 'vector_only' ? 'vector_only' : 'hybrid')
                    }
                  >
                    <option value="hybrid">混合：BM25 + 向量 + RRF（建索引时会写 BM25）</option>
                    <option value="vector_only">
                      仅向量：不写 BM25（更轻；若以后要混合需重建并选混合）
                    </option>
                  </select>
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <p className="text-foreground text-sm font-medium">2. 精排：候选确定之后（与上面独立）</p>
                <Field className="min-w-0">
                  <FieldLabel>条数上限（关精排时截断为此条；开精排时为 rerank 输出上限）</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={rerankTopN}
                    onChange={e => setRerankTopN(e.target.value)}
                  />
                </Field>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`rerank-${game.id}`}
                    className="mt-0.5"
                    checked={useRerank}
                    onCheckedChange={v => setUseRerank(v === true)}
                  />
                  <Label htmlFor={`rerank-${game.id}`} className="text-sm font-normal leading-snug">
                    启用 cross-encoder 精排（关：跳过重排模型，省内存与首包时间；上述选项均写入 manifest，需点「建立/重建索引」生效）
                  </Label>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

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
              onClick={() => void handleBuildIndex()}
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
