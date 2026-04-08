"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, ChevronDown, BookOpen, HelpCircle, FileCode2, Eye } from "lucide-react";
import type { Game } from "@/lib/types";

interface RulesPreviewProps {
  game: Game;
  onRefresh: () => void;
}

export function RulesPreview({ game, onRefresh }: RulesPreviewProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [quickStartOpen, setQuickStartOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!game.rulesMarkdown) {
    return null;
  }

  const md = game.rulesMarkdown;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              规则预览
            </CardTitle>
            <CardDescription>
              格式化视图渲染标题与列表；完整源码含 <code className="text-xs">&lt;!-- pages: … --&gt;</code>{" "}
              锚点（建索引依赖）
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            {isRefreshing ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2 sr-only sm:not-sr-only">刷新</span>
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="rendered" className="w-full">
            <TabsList className="mb-3">
              <TabsTrigger value="rendered" className="gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                格式化
              </TabsTrigger>
              <TabsTrigger value="source" className="gap-1.5">
                <FileCode2 className="h-3.5 w-3.5" />
                完整源码
              </TabsTrigger>
            </TabsList>
            <TabsContent value="rendered" className="mt-0">
              <ScrollArea className="h-80 w-full rounded-md border border-border bg-muted/30 p-4">
                <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-pre:bg-muted prose-pre:border prose-pre:border-border">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="source" className="mt-0">
              <ScrollArea className="h-80 w-full rounded-md border border-border bg-muted/30 p-4">
                <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-relaxed text-foreground">
                  {md}
                </pre>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {game.quickStart ? (
        <Collapsible open={quickStartOpen} onOpenChange={setQuickStartOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer transition-colors hover:bg-muted/50">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">快速入门</CardTitle>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${quickStartOpen ? "rotate-180" : ""}`}
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border border-border bg-muted/20 p-4">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{game.quickStart}</ReactMarkdown>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ) : null}

      {game.suggestedQuestions && game.suggestedQuestions.length > 0 ? (
        <Collapsible open={questionsOpen} onOpenChange={setQuestionsOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer transition-colors hover:bg-muted/50">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <HelpCircle className="h-4 w-4" />
                    建议问题
                  </CardTitle>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${questionsOpen ? "rotate-180" : ""}`}
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
      ) : null}
    </div>
  );
}
