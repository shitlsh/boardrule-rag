import { getRuleEngineBaseUrl } from "@/lib/ingestion/client";

/**
 * Loads LangGraph `draw_mermaid()` text from the rule engine (same source as JSON API).
 */
export async function fetchExtractionMermaidFromRuleEngine(): Promise<string> {
  const base = getRuleEngineBaseUrl();
  const key = process.env.RULE_ENGINE_API_KEY?.trim();
  const headers: Record<string, string> = {};
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  let res: Response;
  try {
    res = await fetch(`${base}/graph/extraction-mermaid`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`无法连接规则引擎: ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `规则引擎返回 ${res.status}`);
  }

  const data = (await res.json()) as { mermaid?: string };
  return data.mermaid ?? "";
}
