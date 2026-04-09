"use client";

import { ClipboardList } from "lucide-react";

import { TaskList } from "@/components/task-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useExtractionTasks } from "@/hooks/use-game";

interface TaskStatusPanelProps {
  gameId: string;
}

/** Sidebar task list (same data as previously lived at the bottom of ``ExtractionPanel``). */
export function TaskStatusPanel({ gameId }: TaskStatusPanelProps) {
  const { tasks, isLoading } = useExtractionTasks(gameId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          任务状态
        </CardTitle>
        <CardDescription>提取与建索引任务进度</CardDescription>
      </CardHeader>
      <CardContent>
        <TaskList tasks={tasks} isLoading={isLoading} />
      </CardContent>
    </Card>
  );
}
