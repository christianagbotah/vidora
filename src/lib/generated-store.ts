import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { NextRequest } from "next/server";

/**
 * Persistent store for runtime-generated media (thumbnails, character
 * portraits, exports, previews, concatenations).
 *
 * WHY: routes previously wrote into `public/generated/`, which for the
 * standalone production server lives INSIDE the build output
 * (`.next/standalone/public/generated/`). `next build` recreates that
 * directory on every deploy, so every thumbnail/export generated before a
 * rebuild 404'd afterwards. The store below lives OUTSIDE `.next` and
 * therefore survives rebuilds and restarts.
 *
 * Directory resolution order:
 *   1. GENERATED_DIR env var (absolute path override)
 *   2. <cwd>/generated-store                    (dev: project root)
 *   3. <cwd>/../../generated-store  (standalone prod: repo root, cwd = .next/standalone)
 *
 * Files are served by the /generated/[...path] route (with fallback to
 * legacy public/generated for pre-migration files).
 */

const ENV_DIR = process.env.GENERATED_DIR;

function resolveStoreDir(): string {
  if (ENV_DIR && path.isAbsolute(ENV_DIR)) return ENV_DIR;
  const cwd = process.cwd();
  // The standalone server runs with cwd = <repo>/.next/standalone —
  // the repo root two levels up survives rebuilds.
  if (cwd.endsWith(path.join(".next", "standalone"))) {
    return path.resolve(cwd, "..", "..", "generated-store");
  }
  return path.join(cwd, "generated-store");
}

const STORE_DIR = resolveStoreDir();

/** Reject path traversal; normalize to a safe relative path. */
export function sanitizeRelPath(relPath: string): string {
  const norm = path.normalize(relPath).replace(/^([.][/\\])+/, "").replace(/^[/\\]+/, "");
  if (norm.startsWith("..") || path.isAbsolute(norm)) {
    throw new Error("Invalid generated path");
  }
  return norm;
}

/** Absolute path of a file inside the store (does not guarantee existence). */
export function generatedFilePath(relPath: string): string {
  return path.join(STORE_DIR, sanitizeRelPath(relPath));
}

/** Absolute store directory (for routes that need a workDir). */
export function generatedStoreDir(): string {
  return STORE_DIR;
}

/** Save a file into the store; returns the public URL (`/generated/<rel>`). */
export async function saveGeneratedFile(
  relPath: string,
  data: Buffer | Uint8Array
): Promise<string> {
  const safe = sanitizeRelPath(relPath);
  const abs = path.join(STORE_DIR, safe);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
  return `/generated/${safe}`;
}

/** Read a generated file: store first, then legacy `public/generated`. */
export async function readGeneratedFile(relPath: string): Promise<Buffer | null> {
  const safe = sanitizeRelPath(relPath);
  try {
    return await readFile(path.join(STORE_DIR, safe));
  } catch {
    /* not in store — try legacy */
  }
  try {
    return await readFile(path.join(process.cwd(), "public", "generated", safe));
  } catch {
    /* not found anywhere */
  }
  return null;
}

/**
 * Public origin of the incoming request (for turning local `/generated/...`
 * paths into absolute URLs the external ZAI API can fetch).
 * Uses forwarded headers so it is correct behind nginx/Cloudflare.
 */
export function publicOrigin(req: NextRequest): string {
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Convert a possibly-local URL into an absolute one the ZAI API can fetch.
 * Returns undefined for data: URLs / anything unusable.
 */
export function toAbsoluteUrl(
  url: string | undefined | null,
  origin: string
): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return `${origin}${url}`;
  return undefined;
}

/**
 * Resolve a public URL path (`/generated/...`, `/music/...`, ...) to an
 * absolute file path for tools like ffmpeg. Checks the generated store
 * first for `/generated/` assets, then `public/`. Returns the public
 * fallback path when nothing exists (callers handle missing files).
 */
export function resolvePublicAssetPath(p: string): string {
  const rel = p.replace(/^\//, "");
  if (rel.startsWith("generated/")) {
    const storePath = path.join(STORE_DIR, rel.slice("generated/".length));
    if (existsSync(storePath)) return storePath;
  }
  return path.join(process.cwd(), "public", rel);
}
