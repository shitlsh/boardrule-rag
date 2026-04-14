/**
 * Bedrock credentials: IAM (AK/SK + optional session) vs single Bedrock API key.
 * IAM secrets are stored as encrypted JSON in apiKeyEnc; api_key mode stores encrypted plain string.
 */

import { encryptSecret } from "@/lib/ai-crypto";
import type { AiCredentialStored, BedrockAuthMode } from "@/lib/ai-gateway-types";

export type BedrockIamPlain = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export function isBedrockIamPayload(plain: string): boolean {
  const t = plain.trim();
  if (!t.startsWith("{")) return false;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    return (
      typeof o.accessKeyId === "string" &&
      o.accessKeyId.length > 0 &&
      typeof o.secretAccessKey === "string" &&
      o.secretAccessKey.length > 0
    );
  } catch {
    return false;
  }
}

export function parseBedrockIamPayload(plain: string): BedrockIamPlain {
  const o = JSON.parse(plain.trim()) as Record<string, unknown>;
  const accessKeyId = typeof o.accessKeyId === "string" ? o.accessKeyId.trim() : "";
  const secretAccessKey = typeof o.secretAccessKey === "string" ? o.secretAccessKey.trim() : "";
  const sessionToken =
    typeof o.sessionToken === "string" && o.sessionToken.trim() !== ""
      ? o.sessionToken.trim()
      : undefined;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Bedrock IAM 凭证格式无效（需要 accessKeyId 与 secretAccessKey）");
  }
  return { accessKeyId, secretAccessKey, sessionToken };
}

/** Encrypt payload for storage in apiKeyEnc. */
export function encryptBedrockApiKeyEnc(
  mode: BedrockAuthMode,
  payload: { apiKey: string } | BedrockIamPlain,
): string {
  if (mode === "api_key") {
    const k = "apiKey" in payload ? payload.apiKey.trim() : "";
    if (!k) throw new Error("Bedrock API Key 不能为空");
    return encryptSecret(k);
  }
  const iam = payload as BedrockIamPlain;
  if (!iam.accessKeyId?.trim() || !iam.secretAccessKey?.trim()) {
    throw new Error("Bedrock IAM 需要 Access Key ID 与 Secret Access Key");
  }
  const obj: Record<string, string> = {
    accessKeyId: iam.accessKeyId.trim(),
    secretAccessKey: iam.secretAccessKey.trim(),
  };
  if (iam.sessionToken?.trim()) obj.sessionToken = iam.sessionToken.trim();
  return encryptSecret(JSON.stringify(obj));
}

export function bedrockKeyLast4FromPlain(plain: string): string | null {
  const t = plain.trim();
  if (!t) return null;
  if (isBedrockIamPayload(t)) {
    try {
      const { secretAccessKey } = parseBedrockIamPayload(t);
      const s = secretAccessKey.trim();
      if (s.length < 4) return s.length > 0 ? s : null;
      return s.slice(-4);
    } catch {
      return null;
    }
  }
  if (t.length < 4) return t.length > 0 ? t : null;
  return t.slice(-4);
}

export function assertBedrockCredentialComplete(c: AiCredentialStored): void {
  if (c.vendor !== "bedrock") return;
  const region = (c.bedrockRegion ?? "").trim();
  if (!region) throw new Error("Bedrock 凭证需要区域（region）");
  const mode = c.bedrockAuthMode;
  if (mode !== "iam" && mode !== "api_key") {
    throw new Error("Bedrock 凭证需要认证方式（iam 或 api_key）");
  }
}
