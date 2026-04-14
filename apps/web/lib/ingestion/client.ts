import { ruleEngineAiHeaders, ruleEngineBearerAuth } from "@/lib/rule-engine-headers";

import type {
  BuildIndexJobPollResponse,
  BuildIndexStartResponse,
  ExtractPagesResponse,
  ExtractPollResponse,
  ExtractStartResponse,
} from "./types";

/** Align with `app/api/chat/stream/route.ts` maxDuration; Node fetch has no default limit. */
const RULE_ENGINE_CHAT_FETCH_MS = 300_000;

/** Poll endpoints should return quickly; cap wait so `/api/games/.../tasks` cannot hang forever. */
const RULE_ENGINE_POLL_FETCH_MS = 60_000;

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && e.name === "AbortError") ||
    (typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError")
  );
}

export function getRuleEngineBaseUrl(): string {
  const raw = process.env.RULE_ENGINE_URL?.trim();
  if (!raw) {
    throw new Error("RULE_ENGINE_URL is not configured");
  }
  return raw.replace(/\/$/, "");
}

export async function prepareRulebookPages(params: {
  gameId: string;
  fileBody: Blob;
  filename: string;
}): Promise<ExtractPagesResponse> {
  const base = getRuleEngineBaseUrl();
  const form = new FormData();
  form.append("game_id", params.gameId);
  form.append("file", params.fileBody, params.filename);

  const res = await fetch(`${base}/extract/pages`, {
    method: "POST",
    headers: ruleEngineBearerAuth(),
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Prepare pages failed: ${res.status}`);
  }

  return (await res.json()) as ExtractPagesResponse;
}

export async function startExtractionWithPagePlan(params: {
  gameId: string;
  gameName?: string;
  terminologyContext?: string;
  pageJobId: string;
  tocPageIndices: number[];
  excludePageIndices: number[];
  /** Skip simple-profile gate; use complex-route heuristics (multipart `force_full_pipeline`). */
  forceFullPipeline?: boolean;
  /** Optional EXTRACTION runtime profile (DB id). */
  extractionProfileId?: string | null;
}): Promise<ExtractStartResponse> {
  const base = getRuleEngineBaseUrl();
  const form = new FormData();
  form.append("game_id", params.gameId);
  form.append("page_job_id", params.pageJobId);
  form.append("toc_page_indices", JSON.stringify(params.tocPageIndices));
  form.append("exclude_page_indices", JSON.stringify(params.excludePageIndices));
  if (params.gameName) {
    form.append("game_name", params.gameName);
  }
  if (params.terminologyContext) {
    form.append("terminology_context", params.terminologyContext);
  }
  form.append("force_full_pipeline", params.forceFullPipeline ? "true" : "false");
  form.append("resume", "false");

  const ai = await ruleEngineAiHeaders({
    mode: "extraction",
    extractionProfileId: params.extractionProfileId,
    gameId: params.gameId,
  });
  const res = await fetch(`${base}/extract`, {
    method: "POST",
    headers: ai,
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Extract start failed: ${res.status}`);
  }

  return (await res.json()) as ExtractStartResponse;
}

export async function getExtractJob(gameId: string, jobId: string): Promise<ExtractPollResponse> {
  const base = getRuleEngineBaseUrl();
  let res: Response;
  try {
    res = await fetch(
      `${base}/games/${encodeURIComponent(gameId)}/extract/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: ruleEngineBearerAuth(),
        cache: "no-store",
        signal: AbortSignal.timeout(RULE_ENGINE_POLL_FETCH_MS),
      },
    );
  } catch (e: unknown) {
    if (isAbortError(e)) {
      throw new Error(
        `规则引擎轮询超时（>${RULE_ENGINE_POLL_FETCH_MS / 1000}s）。请确认 ${base} 可达且未阻塞。`,
      );
    }
    throw e;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Poll failed: ${res.status}`);
  }
  return (await res.json()) as ExtractPollResponse;
}

export async function startBuildIndex(params: {
  gameId: string;
  mergedMarkdown: string;
  sourceFile?: string;
  /** Omitted keys fall back to rule engine env / index profile defaults on the server. */
  similarityTopK?: number;
  rerankTopN?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  retrievalMode?: "hybrid" | "vector_only";
  useRerank?: boolean;
}): Promise<BuildIndexStartResponse> {
  const base = getRuleEngineBaseUrl();
  const ai = await ruleEngineAiHeaders({ gameId: params.gameId });
  const payload: Record<string, unknown> = {
    game_id: params.gameId,
    merged_markdown: params.mergedMarkdown,
    source_file: params.sourceFile ?? "",
  };
  if (params.similarityTopK != null) payload.similarity_top_k = params.similarityTopK;
  if (params.rerankTopN != null) payload.rerank_top_n = params.rerankTopN;
  if (params.chunkSize != null) payload.chunk_size = params.chunkSize;
  if (params.chunkOverlap != null) payload.chunk_overlap = params.chunkOverlap;
  if (params.retrievalMode != null) payload.retrieval_mode = params.retrievalMode;
  if (params.useRerank != null) payload.use_rerank = params.useRerank;
  const res = await fetch(`${base}/build-index/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ai },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Build index start failed: ${res.status}`);
  }
  return (await res.json()) as BuildIndexStartResponse;
}

/** Normalize rule_engine poll JSON (snake_case) and optional camelCase aliases. */
export function normalizeBuildIndexPoll(raw: unknown): BuildIndexJobPollResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("建索引轮询返回非 JSON 对象");
  }
  const o = raw as Record<string, unknown>;
  const job_id =
    typeof o.job_id === "string"
      ? o.job_id
      : typeof o.jobId === "string"
        ? o.jobId
        : "";
  const status = o.status as BuildIndexJobPollResponse["status"];
  const manifest =
    o.manifest !== null && o.manifest !== undefined && typeof o.manifest === "object"
      ? (o.manifest as Record<string, unknown>)
      : null;
  let error: string | null = null;
  if (typeof o.error === "string") {
    error = o.error;
  } else if (o.error !== null && o.error !== undefined) {
    error = String(o.error);
  }
  if (!job_id) {
    throw new Error("建索引响应缺少 job_id");
  }
  if (status !== "pending" && status !== "processing" && status !== "completed" && status !== "failed") {
    throw new Error(`建索引响应 status 无效: ${String(status)}`);
  }
  return { job_id, status, manifest, error };
}

export async function getBuildIndexJob(jobId: string): Promise<BuildIndexJobPollResponse> {
  const base = getRuleEngineBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/build-index/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      headers: ruleEngineBearerAuth(),
      cache: "no-store",
      signal: AbortSignal.timeout(RULE_ENGINE_POLL_FETCH_MS),
    });
  } catch (e: unknown) {
    if (isAbortError(e)) {
      throw new Error(
        `建索引任务轮询超时（>${RULE_ENGINE_POLL_FETCH_MS / 1000}s）。请确认 ${base} 可达。`,
      );
    }
    throw e;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Build index poll failed: ${res.status}`);
  }
  const raw: unknown = await res.json();
  return normalizeBuildIndexPoll(raw);
}

/**
 * Stream chat from rule_engine `POST /chat/stream` (SSE). Caller reads `response.body`.
 * Same auth and timeout pattern as other rule_engine JSON POSTs.
 */
export async function fetchChatRulesStream(params: {
  gameId: string;
  message: string;
  messages?: { role: "user" | "assistant"; content: string }[];
}): Promise<Response> {
  const base = getRuleEngineBaseUrl();
  const ai = await ruleEngineAiHeaders({ gameId: params.gameId });
  return fetch(`${base}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ai },
    body: JSON.stringify({
      game_id: params.gameId,
      message: params.message,
      messages: params.messages ?? [],
    }),
    signal: AbortSignal.timeout(RULE_ENGINE_CHAT_FETCH_MS),
  });
}
