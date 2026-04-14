/**
 * LangGraph `draw_mermaid()` may prepend a YAML block (`---` … `---`) before `graph` / `flowchart`.
 * Some Mermaid.js builds fail to render that block in the browser; strip it and normalize tabs.
 */
export function normalizeExtractionMermaidSource(src: string): string {
  const t = src.replace(/^\uFEFF/, "");
  const lines = t.split(/\r?\n/);
  if (lines.length < 3 || lines[0]?.trim() !== "---") {
    return t.replace(/\t/g, "  ");
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return t.replace(/\t/g, "  ");
  }
  return lines
    .slice(end + 1)
    .join("\n")
    .replace(/\t/g, "  ")
    .trimStart();
}
