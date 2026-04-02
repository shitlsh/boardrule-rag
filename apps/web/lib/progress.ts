export type ProgressPayload = {
  stage?: string;
  detail?: string;
  extractionJobId?: string;
};

export function parseProgressJson(json: string | null): ProgressPayload | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ProgressPayload;
  } catch {
    return null;
  }
}
