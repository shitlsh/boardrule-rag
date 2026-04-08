/** Mirrors `services/rule_engine` extract poll response (snake_case JSON). */
export type ExtractJobStatus = "pending" | "processing" | "completed" | "failed";

export type ExtractStartResponse = {
  job_id: string;
  status: ExtractJobStatus;
  thread_id: string;
  game_id: string;
};

export type ExtractPagesResponse = {
  job_id: string;
  game_id: string;
  total_pages: number;
  pages: { page: number; url: string }[];
};

export type ExtractPollResponse = {
  job_id: string;
  status: ExtractJobStatus;
  game_id: string;
  error: string | null;
  merged_markdown: string | null;
  structured_chapters: { text: string; metadata: Record<string, unknown> }[];
  quick_start: string | null;
  suggested_questions: string[];
  errors: string[];
  last_checkpoint_id: string | null;
  complexity?: string | null;
  extraction_profile?: string | null;
  toc?: Record<string, unknown> | null;
};

/** Mirrors `POST /chat` on the rule engine (snake_case JSON). */
export type ChatSourceRef = {
  game_id: string | null;
  source_file: string | null;
  pages: string | null;
  original_page_range: string | null;
  page_start: number | null;
  page_end: number | null;
  text_preview: string | null;
  score: number | null;
};

export type ChatResponse = {
  answer: string;
  game_id: string;
  sources: ChatSourceRef[];
};
