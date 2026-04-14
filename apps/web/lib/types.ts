export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface Game {
  id: string
  name: string
  slug: string
  coverUrl?: string
  extractionStatus: ExtractionStatus
  /** True when the game has a persisted index and no in-flight index build; use for chat eligibility. */
  isIndexed: boolean
  /** True while INDEX_BUILD task is PENDING or PROCESSING (first build or rebuild). */
  indexBuilding?: boolean
  indexId?: string
  vectorStoreId?: string
  paginationJobId?: string
  extractionJobId?: string
  lastCheckpointId?: string
  rulesMarkdown?: string
  quickStart?: string
  suggestedQuestions?: string[]
  /** Non-fatal rule-engine warnings from the last extraction (e.g. quickstart step failed). */
  extractionWarnings?: string[]
  /** Per-game INDEX template override; null/undefined = use site default. */
  indexProfileId?: string | null
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
  /** Partial extraction warnings (rule engine `errors`) when task completed with issues. */
  warnings?: string[]
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** Assistant only; filled when RAG returns citations (snake_case from API). */
  sources?: Record<string, unknown>[]
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
