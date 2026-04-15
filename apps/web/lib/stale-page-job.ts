/**
 * `POST /extract` can 404 when `page_job_id` does not match rule-engine state:
 * e.g. DB `pageRasterJobId` stale after a new `POST /extract/pages`, deleted PNGs, or missing `page_job.json`.
 * The engine also rehydrates page jobs from `{PAGE_ASSETS_ROOT}/{game_id}/page_job.json` after restarts
 * (`get_job_or_restore`); this helper matches errors that mean "re-run prepare pages".
 */
export function isStalePageJobEngineError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("unknown page_job") ||
    m.includes("prepare pages again") ||
    m.includes("unknown page_job_id")
  );
}
