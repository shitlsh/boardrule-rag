'use client'

import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { PageThumbnail } from '@/lib/types'
import { cn } from '@/lib/utils'

interface PageThumbnailsProps {
  pages: PageThumbnail[]
  isLoading: boolean
}

export function PageThumbnails({ pages, isLoading }: PageThumbnailsProps) {
  if (isLoading) {
    return (
      <div className="flex gap-3 py-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="w-24 h-32 flex-shrink-0 rounded-md" />
        ))}
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        暂无页面，请先上传规则书
      </div>
    )
  }

  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex gap-3 py-2">
        {pages.map((page) => (
          <div
            key={page.pageNumber}
            className={cn(
              "relative flex-shrink-0 w-24 group",
              "rounded-md overflow-hidden border border-border",
              "hover:border-primary/50 transition-colors"
            )}
          >
            <div className="aspect-[3/4] bg-muted">
              <img
                src={page.url}
                alt={`第 ${page.pageNumber} 页`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm px-2 py-1 text-center">
              <span className="text-xs font-medium">{page.label}</span>
            </div>
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}
