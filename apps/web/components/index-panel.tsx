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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { ChevronDown, Database, Check } from 'lucide-react'
import type { Game } from '@/lib/types'
import type { RagOptionsStored } from '@/lib/ai-gateway-types'
import { useExtractionTasks } from '@/hooks/use-game'

interface IndexPanelProps {
  game: Game
  onUpdate: () => void
}

export function IndexPanel({ game, onUpdate }: IndexPanelProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [advOpen, setAdvOpen] = useState(false)
  const [indexProfileOptions, setIndexProfileOptions] = useState<{ id: string; name: string }[]>([])
  const [similarityTopK, setSimilarityTopK] = useState('8')
  const [rerankTopN, setRerankTopN] = useState('5')
  const [chunkSize, setChunkSize] = useState('1024')
  const [chunkOverlap, setChunkOverlap] = useState('128')
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
    fetch('/api/ai-runtime-profiles')
      .then((r) => r.json())
      .then(
        (pack: { profiles: { id: string; name: string; kind: string }[] }) => {
          setIndexProfileOptions(
            pack.profiles.filter((p) => p.kind === 'INDEX').map((p) => ({ id: p.id, name: p.name })),
          )
        },
      )
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const applyRag = (ro: RagOptionsStored) => {
      if (ro.similarityTopK != null) setSimilarityTopK(String(ro.similarityTopK))
      if (ro.rerankTopN != null) setRerankTopN(String(ro.rerankTopN))
      if (ro.chunkSize != null) setChunkSize(String(ro.chunkSize))
      if (ro.chunkOverlap != null) setChunkOverlap(String(ro.chunkOverlap))
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
              if (typeof m.chunk_size === 'number') {
                setChunkSize(String(m.chunk_size))
              }
              if (typeof m.chunk_overlap === 'number') {
                setChunkOverlap(String(m.chunk_overlap))
              }
              if (m.retrieval_mode === 'hybrid' || m.retrieval_mode === 'vector_only') {
                setRetrievalMode(m.retrieval_mode)
              }
              if (typeof m.use_rerank === 'boolean') {
                setUseRerank(m.use_rerank)
              }
              if (typeof m.chunk_size !== 'number' || typeof m.chunk_overlap !== 'number') {
                const pack = (await fetch('/api/ai-runtime-profiles').then((r) => r.json())) as {
                  profiles: { id: string; kind: string; configJson: string }[]
                  activeIndexProfileId: string | null
                }
                const pid = game.indexProfileId ?? pack.activeIndexProfileId
                const prof = pack.profiles.find((p) => p.id === pid && p.kind === 'INDEX')
                if (prof && !cancelled) {
                  try {
                    const cfg = JSON.parse(prof.configJson || '{}') as { ragOptions?: RagOptionsStored }
                    const ro = cfg.ragOptions ?? {}
                    if (typeof m.chunk_size !== 'number' && ro.chunkSize != null) {
                      setChunkSize(String(ro.chunkSize))
                    }
                    if (typeof m.chunk_overlap !== 'number' && ro.chunkOverlap != null) {
                      setChunkOverlap(String(ro.chunkOverlap))
                    }
                  } catch {
                    /* ignore */
                  }
                }
              }
              return
            }
          }
        }
        const pack = (await fetch('/api/ai-runtime-profiles').then((r) => r.json())) as {
          profiles: { id: string; kind: string; configJson: string }[]
          activeIndexProfileId: string | null
        }
        if (cancelled) return
        const pid = game.indexProfileId ?? pack.activeIndexProfileId
        const prof = pack.profiles.find((p) => p.id === pid && p.kind === 'INDEX')
        if (prof) {
          try {
            const cfg = JSON.parse(prof.configJson || '{}') as { ragOptions?: RagOptionsStored }
            applyRag(cfg.ragOptions ?? {})
            return
          } catch {
            /* keep field defaults */
          }
        }
      } catch {
        /* keep field defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [game.id, game.isIndexed, game.indexProfileId])

  const patchGameIndexProfile = useCallback(
    async (value: string) => {
      const indexProfileId = value === '__default__' ? null : value
      try {
        const res = await fetch(`/api/games/${game.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ indexProfileId }),
        })
        const j = (await res.json()) as { message?: string }
        if (!res.ok) {
          toast.error(j.message || '保存失败')
          return
        }
        toast.success('已更新本游戏索引模版')
        onUpdate()
      } catch {
        toast.error('保存失败')
      }
    },
    [game.id, onUpdate],
  )

  const handleBuildIndex = useCallback(async () => {
    setIsSubmitting(true)

    try {
      const sk = Number.parseInt(similarityTopK, 10)
      const rn = Number.parseInt(rerankTopN, 10)
      const cs = Number.parseInt(chunkSize, 10)
      const cco = Number.parseInt(chunkOverlap, 10)
      const payload: Record<string, unknown> = {
        retrievalMode,
        useRerank,
      }
      if (Number.isFinite(sk) && sk > 0) payload.similarityTopK = sk
      if (Number.isFinite(rn) && rn > 0) payload.rerankTopN = rn
      if (Number.isFinite(cs) && cs > 0) payload.chunkSize = cs
      if (Number.isFinite(cco) && cco >= 0) payload.chunkOverlap = cco

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
    chunkOverlap,
    chunkSize,
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
          建立向量索引以启用规则问答。可先选择本游戏使用的<strong className="font-medium text-foreground">索引模版</strong>
          （未选则跟全站默认）。展开「索引选项」可分别设置<strong className="font-medium text-foreground">切片</strong>、
          <strong className="font-medium text-foreground">召回</strong>
          与<strong className="font-medium text-foreground">精排</strong>
          。已建立索引时，下列选项会与规则引擎磁盘上的 <span className="font-mono">manifest.json</span>{' '}
          同步显示（含切片大小；旧索引未存时从当前解析的索引模版补全）。模版在「模型管理 → 索引配置」维护。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {indexProfileOptions.length > 0 ? (
          <div className="mb-4 max-w-md space-y-2">
            <Label>本游戏索引模版</Label>
            <Select
              value={game.indexProfileId ?? '__default__'}
              onValueChange={(v) => void patchGameIndexProfile(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择模版" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">跟随全站默认</SelectItem>
                {indexProfileOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
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
                建库时先用第 1 项把正文切成片段；查询时第 2 项决定<strong className="text-foreground">怎么召回</strong>
                （是否建 BM25）；第 3 项决定召回之后<strong className="text-foreground">要不要</strong>
                cross-encoder 精排，与混合/仅向量检索<strong className="text-foreground">无强制绑定</strong>
                （例如仅向量 + 开精排也可以）。
              </p>

              <div className="flex flex-col gap-3">
                <p className="text-foreground text-sm font-medium">1. 切片（建库）</p>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  控制 Markdown 分节后的 <span className="font-medium text-foreground">SentenceSplitter</span>{' '}
                  目标大小与重叠（与规则引擎一致，按 <strong className="font-medium text-foreground">token</strong>{' '}
                  计）。未改时与「模型管理 → 检索与索引」中的全局默认一致；写入 manifest 的{' '}
                  <span className="font-mono">chunk_size</span> / <span className="font-mono">chunk_overlap</span>{' '}
                  仅作记录，检索阶段不读取。
                </p>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <Field className="flex-1 min-w-0">
                    <FieldLabel>CHUNK_SIZE（token）</FieldLabel>
                    <Input
                      type="number"
                      min={1}
                      max={65536}
                      value={chunkSize}
                      onChange={e => setChunkSize(e.target.value)}
                    />
                  </Field>
                  <Field className="flex-1 min-w-0">
                    <FieldLabel>CHUNK_OVERLAP（token）</FieldLabel>
                    <Input
                      type="number"
                      min={0}
                      max={8192}
                      value={chunkOverlap}
                      onChange={e => setChunkOverlap(e.target.value)}
                    />
                  </Field>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <p className="text-foreground text-sm font-medium">2. 召回：建什么索引、怎么取候选</p>
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
                <p className="text-foreground text-sm font-medium">3. 精排：候选确定之后（与上面独立）</p>
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
