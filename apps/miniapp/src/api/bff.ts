import { BFF_BASE_URL } from '../utils/env'
import { getCachedAccessToken } from '../utils/auth'
import {
  createSseBuffer,
  feedSseBuffer,
  flushSseBufferTail,
  type ChatSseEvent,
} from '../utils/chat-sse'
import type { Game, GameListItem, ChatRequest } from '../types/index'

// -------------------------------------------------------
// 通用 request 封装（将 uni.request 转为 Promise）
// -------------------------------------------------------

function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  const h = { ...base }
  const t = getCachedAccessToken()
  if (t) {
    h['Authorization'] = `Bearer ${t}`
  }
  return h
}

function request<T>(options: UniApp.RequestOptions): Promise<T> {
  const mergedHeader = authHeaders(
    (options.header as Record<string, string> | undefined) ?? {},
  )
  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
      header: mergedHeader,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T)
        } else {
          const data = res.data as Record<string, unknown> | null
          const msg =
            (data?.message as string | undefined) ||
            (data?.error as string | undefined) ||
            `请求失败 (${res.statusCode})`
          reject(new Error(msg))
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg ?? '网络请求失败'))
      },
    })
  })
}

// -------------------------------------------------------
// Games API
// -------------------------------------------------------

/** 获取游戏列表，仅返回已建索引的游戏 */
export async function fetchGames(): Promise<GameListItem[]> {
  const data = await request<GameListItem[]>({
    url: `${BFF_BASE_URL}/api/games`,
    method: 'GET',
  })
  return data.filter((g) => g.isIndexed)
}

/** 获取单个游戏详情（含 quickStart / suggestedQuestions） */
export async function fetchGame(gameId: string): Promise<Game> {
  return request<Game>({
    url: `${BFF_BASE_URL}/api/games/${gameId}`,
    method: 'GET',
  })
}

// -------------------------------------------------------
// Chat API
// -------------------------------------------------------

function isUniH5(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'web'
  } catch {
    return false
  }
}

/**
 * Stream chat via `POST /api/chat/stream` (SSE). Invokes `onEvent` for each parsed frame.
 * H5 uses `fetch`; 微信小程序 uses `enableChunked` + `onChunkReceived`。
 */
export async function streamChatMessage(
  payload: ChatRequest,
  onEvent: (e: ChatSseEvent) => void,
): Promise<void> {
  const headers = authHeaders({
    'Content-Type': 'application/json',
  })

  if (isUniH5()) {
    const res = await fetch(`${BFF_BASE_URL}/api/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string }
      throw new Error(err.message || `请求失败 (${res.status})`)
    }
    const reader = res.body?.getReader()
    if (!reader) {
      throw new Error('无法读取回复流')
    }
    const decoder = new TextDecoder()
    const buf = createSseBuffer()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      feedSseBuffer(buf, decoder.decode(value, { stream: true }), onEvent)
    }
    feedSseBuffer(buf, decoder.decode(), onEvent)
    flushSseBufferTail(buf, onEvent)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const sseBuf = createSseBuffer()
    const decoder = new TextDecoder()
    const reqTask = uni.request({
      url: `${BFF_BASE_URL}/api/chat/stream`,
      method: 'POST',
      header: headers,
      data: payload,
      enableChunked: true,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          feedSseBuffer(sseBuf, decoder.decode(), onEvent)
          flushSseBufferTail(sseBuf, onEvent)
          resolve()
        } else {
          let msg = `请求失败 (${res.statusCode})`
          try {
            const raw = res.data as Record<string, unknown> | string
            if (typeof raw === 'object' && raw && typeof raw.message === 'string') {
              msg = raw.message
            } else if (typeof raw === 'string') {
              const o = JSON.parse(raw) as { message?: string }
              if (o.message) msg = o.message
            }
          } catch {
            /* keep msg */
          }
          reject(new Error(msg))
        }
      },
      fail: (err) => reject(new Error(err.errMsg ?? '网络请求失败')),
    }) as UniApp.RequestTask

    const chunkable = reqTask as UniApp.RequestTask & {
      onChunkReceived?: (cb: (res: { data: ArrayBuffer }) => void) => void
    }
    chunkable.onChunkReceived?.((res: { data: ArrayBuffer }) => {
      const chunk = decoder.decode(res.data, { stream: true })
      feedSseBuffer(sseBuf, chunk, onEvent)
    })
  })
}
