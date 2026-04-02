import type {
  ChatResponse,
  ExtractPagesResponse,
  ExtractPollResponse,
  ExtractStartResponse,
} from "./types";

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
  form.append("resume", "false");

  const res = await fetch(`${base}/extract`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Extract start failed: ${res.status}`);
  }

  return (await res.json()) as ExtractStartResponse;
}

export async function getExtractJob(jobId: string): Promise<ExtractPollResponse> {
  const base = getRuleEngineBaseUrl();
  const res = await fetch(`${base}/extract/${jobId}`, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Poll failed: ${res.status}`);
  }
  return (await res.json()) as ExtractPollResponse;
}

export async function chatRules(params: {
  gameId: string;
  message: string;
  /** Prior turns only (exclude the current message). */
  messages?: { role: "user" | "assistant"; content: string }[];
}): Promise<ChatResponse> {
  const base = getRuleEngineBaseUrl();
  const res = await fetch(`${base}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      game_id: params.gameId,
      message: params.message,
      messages: params.messages ?? [],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Chat failed: ${res.status}`);
  }
  return (await res.json()) as ChatResponse;
}
