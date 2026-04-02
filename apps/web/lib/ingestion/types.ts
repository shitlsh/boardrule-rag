/** Mirrors `services/rule_engine` extract poll response (snake_case JSON). */
export type ExtractJobStatus = "pending" | "processing" | "completed" | "failed";

export type ExtractStartResponse = {
  job_id: string;
  status: ExtractJobStatus;
  thread_id: string;
  game_id: string;
};

export type ExtractPollResponse = {
  job_id: string;
  status: ExtractJobStatus;
  game_id: string;
  error: string | null;
  merged_markdown: string | null;
  quick_start: string | null;
  suggested_questions: string[];
  errors: string[];
  last_checkpoint_id: string | null;
};
