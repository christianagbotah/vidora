/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Reference-Image Orientation Guard
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  WHY: image-to-video engines (Vidu 2 Image/Reference, ViduQ1 Image, and
 *  CogVideoX image mode) derive the OUTPUT video's orientation from the
 *  INPUT reference image. Users select a project orientation (e.g. portrait
 *  9:16), but a character portrait generated before this fix — or any legacy
 *  square 1024x1024 / landscape reference — made the video come out square or
 *  landscape instead of the selected orientation.
 *
 *  New portraits are generated at the project's aspect ratio (see
 *  portraitImageSizeForAspect), but THIS module guards everything else:
 *  before a reference image is handed to the video API, we probe its real
 *  pixel dimensions (PNG IHDR / JPEG SOF parse — no heavy deps), and when the
 *  orientation does not match the project's aspect ratio we center-crop +
 *  scale it to the exact target with ffmpeg. The normalized copy is saved in
 *  the generated store and its URL is used for the video task.
 *
 *  Everything here is NON-FATAL: any failure (unknown format, missing file,
 *  ffmpeg absent) returns the original URL unchanged — generation proceeds
 *  exactly as before.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { resolvePublicAssetPath, saveGeneratedFile } from "./generated-store";
import { REFERENCE_IMAGE_SIZES } from "./image-prompt";

const execFileAsync = promisify(execFile);

interface Dims {
  width: number;
  height: number;
}

/** PNG dimensions from the fixed IHDR header (width @16, height @20). */
function pngDims(buf: Buffer): Dims | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null; // PNG signature
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** JPEG dimensions — walk the segment table to the first SOFn marker. */
function jpegDims(buf: Buffer): Dims | null {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    const isSof =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const len = buf.readUInt16BE(off + 2);
    if (len <= 0) return null; // corrupt segment table
    off += 2 + len;
  }
  return null;
}

function imageDims(buf: Buffer): Dims | null {
  return pngDims(buf) ?? jpegDims(buf);
}

/** Target pixel size for the project's aspect ratio (matches the app's
 *  reference-image sizes; unknown aspects fall back to square). */
function targetDims(aspectRatio: string): Dims {
  const size = REFERENCE_IMAGE_SIZES[(aspectRatio || "").trim()] ?? "1024x1024";
  const [w, h] = size.split("x").map(Number);
  return { width: w, height: h };
}

/** Relative aspect deviation below which we treat the image as matching. */
const ASPECT_TOLERANCE = 0.02;

/**
 * Ensure a LOCAL reference image matches the project's aspect ratio.
 *
 * @param imageUrl    public app URL (`/generated/...` or other local path).
 *                    Absolute/data URLs are returned untouched (we can't —
 *                    and shouldn't — rewrite external images).
 * @param aspectRatio project aspect ratio ("16:9" | "9:16" | "1:1" | …)
 * @param label       logging label (e.g. "Scene 2")
 * @returns the original URL, or a `/generated/refs/...` URL of the
 *          normalized (scale-to-cover + center-crop) copy.
 */
export async function ensureReferenceAspect(
  imageUrl: string,
  aspectRatio: string,
  label = "reference"
): Promise<string> {
  try {
    // Only local app assets can be normalized.
    if (!imageUrl || /^(https?:|data:)/i.test(imageUrl) || !imageUrl.startsWith("/")) {
      return imageUrl;
    }

    const absPath = resolvePublicAssetPath(imageUrl);
    const buf = await readFile(absPath).catch(() => null);
    if (!buf) return imageUrl; // missing file — let the API surface it

    const dims = imageDims(buf);
    if (!dims) return imageUrl; // unknown format — don't touch

    const target = targetDims(aspectRatio);
    const ratio = dims.width / dims.height;
    const targetRatio = target.width / target.height;
    if (Math.abs(ratio - targetRatio) / targetRatio <= ASPECT_TOLERANCE) {
      return imageUrl; // already matches — nothing to do
    }

    // Scale to COVER the target frame, then center-crop to the exact size.
    const { stdout } = await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i", absPath,
        "-vf",
        `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,crop=${target.width}:${target.height}`,
        "-frames:v", "1",
        "-f", "image2",
        "-c:v", "png",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }
    );
    if (!stdout || stdout.length < 100) return imageUrl;

    // Deterministic name — repeated scenes with the same reference reuse it.
    const hash = createHash("sha1")
      .update(absPath)
      .update(aspectRatio)
      .digest("hex")
      .slice(0, 12);
    const newUrl = await saveGeneratedFile(`refs/norm_${hash}.png`, stdout);
    console.log(
      `[aspect-normalize] ${label}: ${dims.width}x${dims.height} (ratio ${ratio.toFixed(3)}) ` +
        `didn't match ${aspectRatio} — normalized to ${target.width}x${target.height} → ${newUrl}`
    );
    return newUrl;
  } catch (err) {
    console.warn(
      `[aspect-normalize] ${label}: normalization skipped ` +
        `(${err instanceof Error ? err.message : String(err)})`
    );
    return imageUrl;
  }
}
