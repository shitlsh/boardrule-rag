"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Gamepad2,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useGame } from "@/hooks/use-game";
import { CHAT_PHASE_LABEL_ZH } from "@/lib/chat-sse-protocol";
import { createSseBuffer, feedSseBuffer } from "@/lib/chat-sse-parse";
import type { ChatSseEvent, ChatSsePhaseId } from "@/lib/chat-sse-protocol";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

const defaultQuickStart = `嗨！我是你们的规则讲解员。欢迎来到这个游戏！

## 一句话目标
快速了解游戏的获胜条件和核心玩法。

## 回合流程
1. 查看规则书中的回合结构。
2. 向 AI 提问以澄清细节。

**好了，开始提问吧！**`;

export default function GameChatPage() {
  const params = useParams<{ gameId: string }>();
  const gameId = typeof params?.gameId === "string" ? params.gameId : "";
  const { game, isLoading, isError } = useGame(gameId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamPhaseLabel, setStreamPhaseLabel] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [quickStartOpen, setQuickStartOpen] = useState(true);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (scrollContainer) {
        (scrollContainer as HTMLElement).scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom, streamPhaseLabel]);

  const handleSend = async (messageText?: string) => {
    const trimmedInput = (messageText || input).trim();
    if (!trimmedInput || isSending || !game) return;

    /** Prior turns only (exclude the message we are about to send). */
    const priorForApi = messages;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedInput,
      createdAt: new Date().toISOString(),
    };

    const assistantId = crypto.randomUUID();
    setStreamingMessageId(assistantId);
    setStreamPhaseLabel(CHAT_PHASE_LABEL_ZH.prepare);
    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput("");
    setIsSending(true);
    if (messages.length === 0) {
      setQuickStartOpen(false);
    }

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: game.id,
          message: trimmedInput,
          messages: priorForApi.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (res.status === 409) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          err.message || "游戏尚未建立索引，请先完成提取并建立索引",
        );
      }

      if (!res.ok) {
        const error = (await res.json()) as { message?: string; error?: string };
        throw new Error(error.message || error.error || "发送失败");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("无法读取回复流");
      }

      const decoder = new TextDecoder();
      const sseBuf = createSseBuffer();
      let accumulated = "";
      let sources: Record<string, unknown>[] | undefined;

      const applyEvent = (ev: ChatSseEvent) => {
        if (ev.type === "phase") {
          const id = ev.id as ChatSsePhaseId;
          if (id in CHAT_PHASE_LABEL_ZH) {
            setStreamPhaseLabel(CHAT_PHASE_LABEL_ZH[id]);
          }
        } else if (ev.type === "delta" && ev.text) {
          accumulated += ev.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: accumulated } : m,
            ),
          );
        } else if (ev.type === "sources") {
          sources = ev.sources as Record<string, unknown>[];
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, sources } : m,
            ),
          );
        } else if (ev.type === "error") {
          throw new Error(ev.message || "流式回答失败");
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        feedSseBuffer(sseBuf, decoder.decode(value, { stream: true }), applyEvent);
      }
      feedSseBuffer(sseBuf, decoder.decode(), applyEvent);

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          const content =
            m.content.trim() ||
            accumulated.trim() ||
            "抱歉，无法生成回复";
          return { ...m, content, sources: sources ?? m.sources };
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送失败，请重试");
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id && m.id !== assistantId));
      setInput(trimmedInput);
    } finally {
      setIsSending(false);
      setStreamPhaseLabel(null);
      setStreamingMessageId(null);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleSuggestedQuestion = (question: string) => {
    void handleSend(question);
  };

  if (!gameId) {
    return null;
  }

  if (isLoading) {
    return <ChatPageSkeleton />;
  }

  if (isError || !game) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/chat">
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

  if (!game.isIndexed) {
    const indexBuilding = Boolean(game.indexBuilding);
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/chat">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{game.name}</h1>
            <p className="text-muted-foreground">
              {indexBuilding
                ? "索引正在建立或更新中，暂时无法问答"
                : "该游戏尚未建立索引，无法使用问答功能"}
            </p>
          </div>
        </div>
        <Card className="max-w-lg">
          <CardContent className="pt-6">
            <p className="mb-4 text-muted-foreground">
              {indexBuilding
                ? "请等待游戏详情页中的建索引任务完成后再试。"
                : "请先在游戏详情页完成规则提取并建立索引后再使用问答功能。"}
            </p>
            <Button asChild>
              <Link href={`/games/${game.id}`}>前往游戏详情</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const suggestedQuestions = game.suggestedQuestions || [
    "这个游戏怎么设置？",
    "游戏的获胜条件是什么？",
    "每个回合该做什么？",
  ];

  const quickStartContent = game.quickStart || defaultQuickStart;

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      <div className="mb-4 flex items-center gap-4 border-b border-border pb-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/chat">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          {game.coverUrl ? (
            <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
              <img src={game.coverUrl} alt={game.name} className="h-full w-full object-cover" />
            </div>
          ) : (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
              <Gamepad2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div>
            <h1 className="text-lg font-semibold">{game.name}</h1>
            <p className="text-xs text-muted-foreground">规则问答</p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea ref={scrollAreaRef} className="flex-1">
          <div className="mx-auto max-w-3xl space-y-4 pb-4">
            {messages.length === 0 ? (
              <div className="mb-6">
                <Collapsible open={quickStartOpen} onOpenChange={setQuickStartOpen}>
                  <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
                    <CollapsibleTrigger asChild>
                      <div className="cursor-pointer p-6 transition-colors hover:bg-muted/30">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                              <BookOpen className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <h2 className="text-lg font-semibold">快速入门</h2>
                              <p className="text-sm text-muted-foreground">了解游戏核心玩法</p>
                            </div>
                          </div>
                          {quickStartOpen ? (
                            <ChevronUp className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="px-6 pb-6 pt-0">
                        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-li:text-muted-foreground">
                          <ReactMarkdown>{quickStartContent}</ReactMarkdown>
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

                <div className="mt-6">
                  <p className="mb-3 text-sm text-muted-foreground">不知道问什么？试试这些：</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedQuestions.map((question, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="h-auto px-3 py-2 text-left"
                        onClick={() => handleSuggestedQuestion(question)}
                      >
                        {question}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                  ) : message.content.trim() ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:text-foreground prose-headings:text-foreground prose-li:text-foreground">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {streamingMessageId === message.id ? (
                        <>
                          <Spinner className="h-4 w-4 shrink-0" />
                          <span>{streamPhaseLabel ?? "请稍候…"}</span>
                        </>
                      ) : (
                        <span>…</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="mt-auto border-t border-border pt-4">
          <div className="mx-auto flex max-w-3xl gap-3">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题，按 Enter 发送..."
              className="min-h-[56px] max-h-32 resize-none rounded-2xl"
              disabled={isSending}
            />
            <Button
              onClick={() => void handleSend()}
              disabled={!input.trim() || isSending}
              size="icon"
              className="h-14 w-14 flex-shrink-0 rounded-2xl"
            >
              {isSending ? <Spinner className="h-5 w-5" /> : <Send className="h-5 w-5" />}
              <span className="sr-only">发送</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-md" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <Skeleton className="h-64 w-full max-w-3xl" />
    </div>
  );
}
