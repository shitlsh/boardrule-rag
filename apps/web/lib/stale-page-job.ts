/**
 * Rule engine keeps rasterization jobs in memory (`ingestion/page_jobs.py`).
 * After a restart, `POST /extract` returns 404 with unknown page_job_id while DB still holds `pageRasterJobId`.
 */
export function isStalePageJobEngineError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("unknown page_job") ||
    m.includes("prepare pages again") ||
    m.includes("unknown page_job_id")
  );
}
