import { Badge } from '@/components/ui/badge'
import type { ExtractionStatus, TaskStatus } from '@/lib/types'

const extractionStatusConfig: Record<ExtractionStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '待处理', variant: 'secondary' },
  processing: { label: '处理中', variant: 'outline' },
  completed: { label: '已完成', variant: 'default' },
  failed: { label: '失败', variant: 'destructive' },
}

const taskStatusConfig: Record<TaskStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: '等待中', variant: 'secondary' },
  running: { label: '执行中', variant: 'outline' },
  completed: { label: '已完成', variant: 'default' },
  failed: { label: '失败', variant: 'destructive' },
}

interface ExtractionStatusBadgeProps {
  status: ExtractionStatus
}

export function ExtractionStatusBadge({ status }: ExtractionStatusBadgeProps) {
  const config = extractionStatusConfig[status]
  return (
    <Badge variant={config.variant} aria-label={`提取状态: ${config.label}`}>
      {config.label}
    </Badge>
  )
}

interface TaskStatusBadgeProps {
  status: TaskStatus
}

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const config = taskStatusConfig[status]
  return (
    <Badge variant={config.variant} aria-label={`任务状态: ${config.label}`}>
      {config.label}
    </Badge>
  )
}

interface IndexStatusBadgeProps {
  isIndexed: boolean
}

export function IndexStatusBadge({ isIndexed }: IndexStatusBadgeProps) {
  return (
    <Badge 
      variant={isIndexed ? 'default' : 'secondary'}
      aria-label={isIndexed ? '已建索引' : '未建索引'}
    >
      {isIndexed ? '已索引' : '未索引'}
    </Badge>
  )
}
