import { NextResponse } from "next/server";

import { getAiGatewayStored, getCredentialApiKey } from "@/lib/ai-gateway";

export const runtime = "nodejs";

type GoogleListModelsResponse = {
  models?: {
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }[];
};

/**
 * List Gemini models for a stored credential (used after picking provider alias in settings).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const credentialId = searchParams.get("credentialId")?.trim();
  if (!credentialId) {
    return NextResponse.json({ message: "credentialId 必填" }, { status: 400 });
  }

  let apiKey: string;
  try {
    const stored = await getAiGatewayStored();
    apiKey = getCredentialApiKey(stored, credentialId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "读取凭证失败";
    return NextResponse.json({ message: msg }, { status: 400 });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { method: "GET", next: { revalidate: 0 } });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { message: text || `Google API error: ${res.status}` },
        { status: 502 },
      );
    }
    const data = JSON.parse(text) as GoogleListModelsResponse;
    const raw = data.models ?? [];
    const models = raw
      .map((m) => {
        const name = typeof m.name === "string" ? m.name : "";
        const methods = m.supportedGenerationMethods ?? [];
        const canGen = methods.some((x) => /generateContent/i.test(String(x)));
        const canEmbed = methods.some((x) => /embedContent/i.test(String(x)));
        return {
          name,
          displayName: m.displayName ?? name,
          capabilities: { generateContent: canGen, embedContent: canEmbed },
        };
      })
      .filter((m) => m.name && (m.capabilities.generateContent || m.capabilities.embedContent));

    return NextResponse.json({ models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "拉取模型列表失败";
    return NextResponse.json({ message: msg }, { status: 500 });
  }
}
