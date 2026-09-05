import crypto from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { resolvePublicAssetPath, sanitizeRelPath } from "./generated-store";

const TOKEN_VERSION = 1;
export const PROVIDER_MEDIA_TTL_SECONDS = 15 * 60;
export const PROVIDER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

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

function localGeneratedBase64(parsed: URL): string | undefined {
  if (!parsed.pathname.startsWith("/generated/")) return undefined;

  const ext = path.extname(parsed.pathname).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(ext)) return undefined;

  try {
    const filePath = resolvePublicAssetPath(parsed.pathname);
    const bytes = readFileSync(filePath);
    if (bytes.length === 0 || bytes.length > PROVIDER_IMAGE_MAX_BYTES) return undefined;
    return bytes.toString("base64");
  } catch {
    return undefined;
  }
}

/**
 * Prepare image input for an external rendering provider.
 *
 * Z.ai's video API accepts image_url as either a URL or Base64 image bytes.
 * For Vidora-owned same-origin /generated/* PNG/JPEG assets, prefer Base64 so
 * the provider never has to traverse Cloudflare, session auth, cookies, DNS,
 * or signed-media routing to fetch a private reference image. Third-party
 * image URLs are left untouched.
 *
 * If a local generated file is unavailable, unsupported, or above Z.ai's 5 MB
 * input limit, fall back to the existing short-lived signed capability URL.
 */
export function toProviderFetchUrl(
  mediaUrl: string | undefined | null,
  origin: string
): string | undefined {
  if (!mediaUrl) return undefined;
  const normalizedOrigin = origin.replace(/\/$/, "");
  let parsed: URL;
  let originUrl: URL;
  try {
    parsed = new URL(mediaUrl, `${normalizedOrigin}/`);
    originUrl = new URL(normalizedOrigin);
  } catch {
    return undefined;
  }

  if (!/^https?:$/.test(parsed.protocol)) return undefined;
  if (parsed.origin !== originUrl.origin) return parsed.toString();
  if (!parsed.pathname.startsWith("/generated/")) return parsed.toString();

  const inline = localGeneratedBase64(parsed);
  if (inline) return inline;

  const rel = sanitizeRelPath(decodeURIComponent(parsed.pathname.slice("/generated/".length)));
  const { exp, sig } = createProviderMediaToken(rel);
  parsed.searchParams.set("vpm_exp", String(exp));
  parsed.searchParams.set("vpm_sig", sig);
  return parsed.toString();
}
