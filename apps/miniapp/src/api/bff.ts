import { BFF_BASE_URL } from '../utils/env'
import type {
  Game,
  GameListItem,
  ChatRequest,
  ChatBffResponse,
} from '../types/index'

// -------------------------------------------------------
// 通用 request 封装（将 uni.request 转为 Promise）
// -------------------------------------------------------

function request<T>(options: UniApp.RequestOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
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

/** 发送消息，返回完整 BFF 响应 */
export async function sendChatMessage(payload: ChatRequest): Promise<ChatBffResponse> {
  return request<ChatBffResponse>({
    url: `${BFF_BASE_URL}/api/chat`,
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    data: payload,
  })
}
