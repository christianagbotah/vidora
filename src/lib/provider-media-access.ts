import crypto from "crypto";
import { sanitizeRelPath } from "./generated-store";

const TOKEN_VERSION = 1;
export const PROVIDER_MEDIA_TTL_SECONDS = 15 * 60;

function signingSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for provider media signing");
  }
  return secret;
}

function signatureFor(relPath: string, exp: number): string {
  const safe = sanitizeRelPath(relPath);
  return crypto
    .createHmac("sha256", signingSecret())
    .update(`${TOKEN_VERSION}\n${safe}\n${exp}`, "utf8")
    .digest("base64url");
}

export function createProviderMediaToken(
  relPath: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): { exp: number; sig: string } {
  const safe = sanitizeRelPath(relPath);
  const exp = nowSeconds + PROVIDER_MEDIA_TTL_SECONDS;
  return { exp, sig: signatureFor(safe, exp) };
}

export function verifyProviderMediaToken(
  relPath: string,
  expValue: string | null | undefined,
  suppliedSignature: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!expValue || !suppliedSignature || !/^\d+$/.test(expValue)) return false;
  const exp = Number(expValue);
  if (!Number.isSafeInteger(exp) || exp < nowSeconds) return false;
  // Reject unexpectedly long-lived capabilities even if a future caller signs one.
  if (exp > nowSeconds + PROVIDER_MEDIA_TTL_SECONDS + 60) return false;

  let expected: string;
  try {
    expected = signatureFor(relPath, exp);
  } catch {
    return false;
  }
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return supplied.length === wanted.length && crypto.timingSafeEqual(supplied, wanted);
}

/**
 * Produce a short-lived URL an external rendering provider can fetch without
 * receiving the user's Vidora session cookie. Only same-origin /generated/*
 * media is signed; unrelated/external URLs pass through unchanged.
 */
export function toProviderFetchUrl(
  mediaUrl: string | undefined | null,
  origin: string
): string | undefined {
  if (!mediaUrl) return undefined;
  const normalizedOrigin = origin.replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(mediaUrl, `${normalizedOrigin}/`);
  } catch {
    return undefined;
  }

  if (!/^https?:$/.test(parsed.protocol)) return undefined;
  if (parsed.origin !== new URL(normalizedOrigin).origin) return parsed.toString();
  if (!parsed.pathname.startsWith("/generated/")) return parsed.toString();

  const rel = sanitizeRelPath(decodeURIComponent(parsed.pathname.slice("/generated/".length)));
  const { exp, sig } = createProviderMediaToken(rel);
  parsed.searchParams.set("vpm_exp", String(exp));
  parsed.searchParams.set("vpm_sig", sig);
  return parsed.toString();
}
