'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { PageThumbnail } from '@/lib/types'
import { cn } from '@/lib/utils'

interface PageThumbnailsProps {
  pages: PageThumbnail[]
  isLoading: boolean
}

export function PageThumbnails({ pages, isLoading }: PageThumbnailsProps) {
  const [lightbox, setLightbox] = useState<PageThumbnail | null>(null)

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
    <>
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-3 py-2">
          {pages.map((page) => (
            <button
              key={page.pageNumber}
              type="button"
              title="点击放大"
              onClick={() => setLightbox(page)}
              className={cn(
                'relative flex-shrink-0 w-24 text-left',
                'rounded-md overflow-hidden border border-border',
                'hover:border-primary/50 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
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
            </button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <Dialog open={lightbox != null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent
          showCloseButton
          className="max-h-[90vh] max-w-[min(100vw-2rem,56rem)] gap-2 overflow-y-auto p-4 sm:max-w-[min(100vw-2rem,56rem)]"
        >
          <DialogTitle className="sr-only">
            {lightbox ? `第 ${lightbox.pageNumber} 页` : '预览'}
          </DialogTitle>
          {lightbox ? (
            <img
              src={lightbox.url}
              alt={`第 ${lightbox.pageNumber} 页`}
              className="mx-auto max-h-[min(85vh,1200px)] w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
