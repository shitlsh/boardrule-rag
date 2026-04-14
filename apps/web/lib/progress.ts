export type ProgressPayload = {
  stage?: string;
  detail?: string;
  extractionJobId?: string;
  /** Rule-engine partial-failure messages when status is still completed. */
  warnings?: string[];
};

export function parseProgressJson(json: string | null): ProgressPayload | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ProgressPayload;
  } catch {
    return null;
  }
}
