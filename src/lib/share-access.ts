import crypto from "crypto";

const SHARE_ACCESS_TTL_SECONDS = 60 * 60;
const TOKEN_VERSION = 1;

function signingSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for share access signing");
  }
  return secret;
}

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(encoded: string): string {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(encoded, "utf8")
    .digest("base64url");
}

export function shareAccessCookieName(projectId: string): string {
  const safe = projectId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return `vidora_share_${safe}`;
}

export function createShareAccessToken(projectId: string): {
  token: string;
  maxAge: number;
} {
  const payload = {
    v: TOKEN_VERSION,
    projectId,
    exp: Math.floor(Date.now() / 1000) + SHARE_ACCESS_TTL_SECONDS,
  };
  const encoded = encodePayload(payload);
  return {
    token: `${encoded}.${sign(encoded)}`,
    maxAge: SHARE_ACCESS_TTL_SECONDS,
  };
}

export function verifyShareAccessToken(
  token: string | undefined,
  expectedProjectId: string
): boolean {
  if (!token) return false;
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length > 0) return false;

  const expected = sign(encoded);
  const suppliedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as { v?: number; projectId?: string; exp?: number };
    return (
      parsed.v === TOKEN_VERSION &&
      parsed.projectId === expectedProjectId &&
      typeof parsed.exp === "number" &&
      parsed.exp >= Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}
