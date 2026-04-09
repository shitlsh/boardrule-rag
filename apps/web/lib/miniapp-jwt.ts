import * as jose from "jose";

const ISSUER = "boardrule-bff";
const AUDIENCE = "boardrule-miniapp";

export type MiniappJwtPayload = {
  sub: string;
  typ: "miniapp";
};

function getSecret(): Uint8Array {
  const raw = process.env.MINIAPP_JWT_SECRET?.trim();
  if (!raw) {
    throw new Error("MINIAPP_JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(raw);
}

export async function signMiniappJwt(openid: string, maxAgeSeconds = 7 * 24 * 60 * 60): Promise<string> {
  const secret = getSecret();
  return new jose.SignJWT({ typ: "miniapp" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(openid)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(secret);
}

export async function verifyMiniappJwt(token: string): Promise<MiniappJwtPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (payload.typ !== "miniapp" || typeof payload.sub !== "string" || !payload.sub) {
      return null;
    }
    return { sub: payload.sub, typ: "miniapp" };
  } catch {
    return null;
  }
}
