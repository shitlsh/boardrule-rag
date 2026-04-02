export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface Game {
  id: string
  name: string
  slug: string
  coverUrl?: string
  extractionStatus: ExtractionStatus
  isIndexed: boolean
  indexId?: string
  vectorStoreId?: string
  paginationJobId?: string
  extractionJobId?: string
  lastCheckpointId?: string
  rulesMarkdown?: string
  quickStart?: string
  suggestedQuestions?: string[]
  createdAt: string
  updatedAt: string
}

export interface PageThumbnail {
  pageNumber: number
  url: string
  label: string
}

export interface ExtractionTask {
  id: string
  type: string
  status: TaskStatus
  progress?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface ChatRequest {
  gameId: string
  message: string
  messages?: ChatMessage[]
}

export interface ChatResponse {
  message: ChatMessage
}

export interface CreateGameRequest {
  name: string
  coverUrl?: string
}

export interface ExtractionRequest {
  tocPages?: string
  excludePages?: string
  terminologyContext?: string
}
