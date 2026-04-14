'use client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { TaskStatusBadge } from '@/components/status-badge'
import { ClipboardList } from 'lucide-react'
import type { ExtractionTask } from '@/lib/types'

interface TaskListProps {
  tasks: ExtractionTask[]
  isLoading: boolean
}

export function TaskList({ tasks, isLoading }: TaskListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardList />
          </EmptyMedia>
          <EmptyTitle>暂无任务</EmptyTitle>
          <EmptyDescription>开始提取后将在此显示任务进度</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>任务类型</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>进度</TableHead>
          <TableHead>错误 / 警告</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="font-medium">{task.type}</TableCell>
            <TableCell>
              <TaskStatusBadge status={task.status} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {task.progress || '-'}
            </TableCell>
            <TableCell className="max-w-md">
              {task.error ? (
                <span className="text-destructive">{task.error}</span>
              ) : task.warnings?.length ? (
                <span className="text-amber-700 dark:text-amber-400 text-sm whitespace-pre-wrap break-words">
                  {task.warnings.join('\n')}
                </span>
              ) : (
                '-'
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
