'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { RefreshCw, ChevronDown, BookOpen, HelpCircle } from 'lucide-react'
import type { Game } from '@/lib/types'

interface RulesPreviewProps {
  game: Game
  onRefresh: () => void
}

export function RulesPreview({ game, onRefresh }: RulesPreviewProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  if (!game.rulesMarkdown) {
    return null
  }

  return (
    <div className="space-y-4">
      {/* Markdown Preview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              规则预览
            </CardTitle>
            <CardDescription>提取完成的规则书内容</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2 sr-only sm:not-sr-only">刷新</span>
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80 w-full rounded-md border border-border bg-muted/30 p-4">
            <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed">
              {game.rulesMarkdown}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Quick Start */}
      {game.quickStart && (
        <Collapsible open={quickStartOpen} onOpenChange={setQuickStartOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">快速入门</CardTitle>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      quickStartOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {game.quickStart}
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Suggested Questions */}
      {game.suggestedQuestions && game.suggestedQuestions.length > 0 && (
        <Collapsible open={questionsOpen} onOpenChange={setQuestionsOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <HelpCircle className="h-4 w-4" />
                    建议问题
                  </CardTitle>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      questionsOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <ul className="space-y-2">
                  {game.suggestedQuestions.map((question, index) => (
                    <li
                      key={index}
                      className="text-sm text-muted-foreground py-2 px-3 rounded-md bg-muted/50 hover:bg-muted transition-colors"
                    >
                      {question}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </div>
  )
}
