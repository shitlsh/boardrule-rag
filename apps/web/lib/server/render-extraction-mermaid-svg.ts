import { normalizeExtractionMermaidSource } from "@/lib/extraction-mermaid";

/**
 * Renders Mermaid to SVG in Node using happy-dom + the same `mermaid` package as the web app.
 * Serialized with a queue: mermaid touches `globalThis.document`; concurrent renders would corrupt each other.
 */
let renderQueue: Promise<void> = Promise.resolve();

async function withHappyDomGlobals<T>(fn: () => Promise<T>): Promise<T> {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "http://localhost/" });
  const g = globalThis as Record<string, unknown>;
  const backup: Record<string, unknown> = {
    window: g.window,
    document: g.document,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
    getComputedStyle: g.getComputedStyle,
  };
  try {
    g.window = window;
    g.document = window.document;
    g.requestAnimationFrame = window.requestAnimationFrame.bind(window);
    g.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    g.getComputedStyle = window.getComputedStyle.bind(window);
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(backup)) {
      if (v === undefined) {
        delete (g as Record<string, unknown>)[k];
      } else {
        (g as Record<string, unknown>)[k] = v;
      }
    }
  }
}

export async function renderExtractionMermaidToSvg(source: string): Promise<string> {
  const text = normalizeExtractionMermaidSource(source).trim();
  if (!text) {
    throw new Error("Empty mermaid source");
  }

  const work = async () => {
    return withHappyDomGlobals(async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "neutral" });
      const doc = (globalThis as unknown as { document: Document }).document;
      const holder = doc.createElement("div");
      doc.body.appendChild(holder);
      const id = `mmd-srv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const { svg } = await mermaid.render(id, text, holder);
      return svg;
    });
  };

  const next = renderQueue.then(work, work);
  renderQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
