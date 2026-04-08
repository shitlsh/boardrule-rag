import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "v1";
const ALGO = "aes-256-gcm";

function getKey32(): Buffer {
  const secret = process.env.AI_CONFIG_SECRET?.trim();
  if (!secret) {
    throw new Error("AI_CONFIG_SECRET is not set (required to store API keys)");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypt UTF-8 plaintext; returns opaque ASCII string safe for JSON. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey32(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(enc: string): string {
  const parts = enc.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Invalid encrypted secret format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, "base64url");
  const tag = Buffer.from(tagB64!, "base64url");
  const data = Buffer.from(dataB64!, "base64url");
  const decipher = createDecipheriv(ALGO, getKey32(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
