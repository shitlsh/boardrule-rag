/** Parses TOC / exclude page fields from form text or JSON arrays (matches POST /api/tasks). */
export function parsePageIndices(raw: unknown): number[] {
  if (raw == null || raw === "") {
    return [];
  }
  if (typeof raw !== "string") {
    return [];
  }
  const s = raw.trim();
  if (!s) {
    return [];
  }
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s) as unknown;
      if (!Array.isArray(arr)) {
        return [];
      }
      return arr.filter((x): x is number => typeof x === "number" && Number.isInteger(x));
    } catch {
      return [];
    }
  }
  return s
    .split(/[\s,]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => !Number.isNaN(n));
}
