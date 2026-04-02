'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { PageThumbnails } from '@/components/page-thumbnails'
import { TaskList } from '@/components/task-list'
import { usePageThumbnails, useExtractionTasks } from '@/hooks/use-game'
import { toast } from 'sonner'
import { Upload, Play, FileText } from 'lucide-react'
import type { Game } from '@/lib/types'

interface ExtractionPanelProps {
  game: Game
  onUpdate: () => void
}

export function ExtractionPanel({ game, onUpdate }: ExtractionPanelProps) {
  const { pages, isLoading: pagesLoading, mutate: mutatePages } = usePageThumbnails(game.id)
  const { tasks, isLoading: tasksLoading } = useExtractionTasks(game.id)
  
  const [isUploading, setIsUploading] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [tocPages, setTocPages] = useState('')
  const [excludePages, setExcludePages] = useState('')
  const [terminologyContext, setTerminologyContext] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/games/${game.id}/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || '上传失败')
      }

      toast.success('规则书已上传，正在分页处理')
      mutatePages()
      onUpdate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '上传失败，请重试')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleStartExtraction = async () => {
    setIsExtracting(true)

    try {
      const res = await fetch(`/api/games/${game.id}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tocPages: tocPages.trim() || undefined,
          excludePages: excludePages.trim() || undefined,
          terminologyContext: terminologyContext.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || '启动提取失败')
      }

      toast.success('规则提取任务已启动')
      onUpdate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动提取失败，请重试')
    } finally {
      setIsExtracting(false)
    }
  }

  const hasPagination = !!game.paginationJobId
  const isProcessing = game.extractionStatus === 'processing'

  return (
    <div className="space-y-6">
      {/* Step 1: Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            步骤一：上传规则书
          </CardTitle>
          <CardDescription>
            上传 PDF 或图片文件，系统将自动分页处理
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/*"
            onChange={handleFileUpload}
            className="hidden"
            id="rulebook-upload"
          />
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Spinner className="mr-2" />
                  上传中...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  选择文件
                </>
              )}
            </Button>
            {hasPagination && (
              <span className="text-sm text-muted-foreground">
                已有分页数据，重新上传将覆盖
              </span>
            )}
          </div>

          {/* Page Thumbnails */}
          <div className="mt-4">
            <PageThumbnails pages={pages} isLoading={pagesLoading} />
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Page Plan */}
      <Card>
        <CardHeader>
          <CardTitle>步骤二：页面配置</CardTitle>
          <CardDescription>
            设置目录页、排除页等参数以优化提取效果
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="tocPages">目录页（逗号分隔）</FieldLabel>
              <Input
                id="tocPages"
                placeholder="例如: 2,3"
                value={tocPages}
                onChange={(e) => setTocPages(e.target.value)}
                disabled={isExtracting || isProcessing}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="excludePages">排除页（逗号分隔）</FieldLabel>
              <Input
                id="excludePages"
                placeholder="例如: 1,15,16（封面、广告页等）"
                value={excludePages}
                onChange={(e) => setExcludePages(e.target.value)}
                disabled={isExtracting || isProcessing}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="terminologyContext">术语上下文（可选）</FieldLabel>
              <Textarea
                id="terminologyContext"
                placeholder="输入游戏相关的术语说明，帮助 AI 更准确理解规则"
                value={terminologyContext}
                onChange={(e) => setTerminologyContext(e.target.value)}
                disabled={isExtracting || isProcessing}
                rows={3}
              />
            </Field>
          </FieldGroup>
          <div className="mt-4">
            <Button
              onClick={handleStartExtraction}
              disabled={!hasPagination || isExtracting || isProcessing}
            >
              {isExtracting || isProcessing ? (
                <>
                  <Spinner className="mr-2" />
                  处理中...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  开始提取
                </>
              )}
            </Button>
            {!hasPagination && (
              <p className="text-sm text-muted-foreground mt-2">
                请先上传规则书并完成分页
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Task List */}
      <Card>
        <CardHeader>
          <CardTitle>任务状态</CardTitle>
          <CardDescription>
            查看提取任务的执行进度
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TaskList tasks={tasks} isLoading={tasksLoading} />
        </CardContent>
      </Card>
    </div>
  )
}
