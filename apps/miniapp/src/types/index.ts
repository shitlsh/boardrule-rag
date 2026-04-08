// -------------------------------------------------------
// BFF 响应类型（与 apps/web/lib/types.ts 保持对齐）
// -------------------------------------------------------

export interface Game {
  id: string
  name: string
  slug: string
  coverUrl: string | null
  isIndexed: boolean
  indexId: string | null
  extractionStatus: string | null
  quickStart: string | null
  suggestedQuestions: string[]
  rulesMarkdown: string | null
}

// -------------------------------------------------------
// 聊天相关类型
// -------------------------------------------------------

export interface SourceRef {
  game_id: string | null
  source_file: string | null
  /** 已格式化的页码字符串，例如 "12-15" */
  pages: string | null
  original_page_range: string | null
  page_start: number | null
  page_end: number | null
  text_preview: string | null
  score: number | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** 仅 assistant 消息有效 */
  sources?: SourceRef[]
}

/** POST /api/chat 请求体 */
export interface ChatRequest {
  gameId: string
  message: string
  messages: { role: 'user' | 'assistant'; content: string }[]
}

/** POST /api/chat BFF 响应体 */
export interface ChatBffResponse {
  message: {
    id: string
    role: 'assistant'
    content: string
    createdAt: string
  }
  answer: string
  game_id: string
  sources: SourceRef[]
}

/** GET /api/games 列表响应（元素） */
export type GameListItem = Pick<
  Game,
  'id' | 'name' | 'slug' | 'coverUrl' | 'isIndexed' | 'extractionStatus'
>
