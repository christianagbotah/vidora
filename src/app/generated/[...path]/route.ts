import { NextRequest, NextResponse } from "next/server";
import { readGeneratedFile, sanitizeRelPath } from "@/lib/generated-store";

export const runtime = "nodejs";

/**
 * GET /generated/[...path]
 *
 * Serves runtime-generated media (thumbnails, portraits, exports,
 * previews) from the persistent generated-store — which survives
 * `next build` + standalone deploys, unlike public/generated.
 * Falls back to legacy public/generated for pre-migration files.
 *
 * Supports HTTP Range requests so exported videos can be seeked /
 * played on iOS Safari.
 */

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  let rel: string;
  try {
    rel = sanitizeRelPath(segments.join("/"));
  } catch {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const buffer = await readGeneratedFile(rel);
  if (!buffer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";
  const total = buffer.length;

  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  // ── Range request support (video seeking / Safari playback) ──
  const range = req.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const startRaw = match[1];
      const endRaw = match[2];
      let start = startRaw ? parseInt(startRaw, 10) : 0;
      let end = endRaw ? parseInt(endRaw, 10) : total - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start >= total || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      start = Math.max(0, start);
      end = Math.min(total - 1, end);

      const chunk = buffer.subarray(start, end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": chunk.length.toString(),
        },
      });
    }
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": total.toString(),
    },
  });
}
