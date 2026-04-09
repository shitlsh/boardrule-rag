'use client'

import useSWR from 'swr'
import type { Game, PageThumbnail, ExtractionTask } from '@/lib/types'

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then(res => {
  if (!res.ok) throw new Error('请求失败')
  return res.json()
})

export function useGame(gameId: string) {
  const { data, error, isLoading, mutate } = useSWR<Game>(
    gameId ? `/api/games/${gameId}` : null,
    fetcher,
    { refreshInterval: 5000 }
  )

  return {
    game: data,
    isLoading,
    isError: error,
    mutate,
  }
}

export function useGames() {
  const { data, error, isLoading, mutate } = useSWR<Game[]>(
    '/api/games',
    fetcher
  )

  return {
    games: data ?? [],
    isLoading,
    isError: error,
    mutate,
  }
}

export function usePageThumbnails(gameId: string) {
  const { data, error, isLoading, mutate } = useSWR<PageThumbnail[]>(
    gameId ? `/api/games/${gameId}/pages` : null,
    fetcher
  )

  return {
    pages: data ?? [],
    isLoading,
    isError: error,
    mutate,
  }
}

export function useExtractionTasks(gameId: string) {
  const { data, error, isLoading, mutate } = useSWR<ExtractionTask[]>(
    gameId ? `/api/games/${gameId}/tasks` : null,
    fetcher,
    { refreshInterval: 3000 }
  )

  return {
    tasks: data ?? [],
    isLoading,
    isError: error,
    mutate,
  }
}
