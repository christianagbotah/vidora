import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireProjectAccess } from "@/lib/project-auth";
import { readGeneratedFile, sanitizeRelPath } from "@/lib/generated-store";

export const runtime = "nodejs";

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

type MediaAccess = { allowed: boolean; publicCache: boolean };

async function authorizeGeneratedMedia(rel: string): Promise<MediaAccess> {
  // Watermarked previews are deliberately public acquisition assets.
  if (rel.startsWith("previews/")) {
    return { allowed: true, publicCache: true };
  }

  // Standalone generated assets are stored under users/<ownerId>/... .
  if (rel.startsWith("users/")) {
    const ownerId = rel.split("/")[1] || "";
    const auth = await requireAuth();
    if (!auth.ok) return { allowed: false, publicCache: false };
    return {
      allowed: auth.session.userId === ownerId || auth.session.role === "admin",
      publicCache: false,
    };
  }

  const mediaUrl = `/generated/${rel}`;
  const project = await db.videoProject.findFirst({
    where: {
      OR: [
        { finalVideoUrl: mediaUrl },
        {
          scenes: {
            some: {
              OR: [
                { imageUrl: mediaUrl },
                { videoUrl: mediaUrl },
                { referenceImageUrl: mediaUrl },
                { musicTrackUrl: mediaUrl },
              ],
            },
          },
        },
        { characters: { some: { imageUrl: mediaUrl } } },
      ],
    },
    select: { id: true, isPublic: true, sharePassword: true },
  });

  if (project) {
    if (project.isPublic && !project.sharePassword) {
      return { allowed: true, publicCache: true };
    }
    const access = await requireProjectAccess(project.id, false);
    return { allowed: access.ok, publicCache: false };
  }

  // Brand assets can also live in the generated store. They are private to
  // their owner unless intentionally copied into an explicitly public project.
  const brand = await db.brandKit.findFirst({
    where: { logoUrl: mediaUrl },
    select: { userId: true },
  });
  if (brand) {
    const auth = await requireAuth();
    if (!auth.ok) return { allowed: false, publicCache: false };
    return {
      allowed: auth.session.userId === brand.userId || auth.session.role === "admin",
      publicCache: false,
    };
  }

  // Fail closed for orphaned/legacy generated files. Knowing a filename is not
  // proof of authorization.
  return { allowed: false, publicCache: false };
}

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

  const access = await authorizeGeneratedMedia(rel);
  if (!access.allowed) {
    // A 404 avoids confirming whether a private generated object exists.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await readGeneratedFile(rel);
  if (!buffer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const dot = rel.lastIndexOf(".");
  const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : "";
  const contentType = MIME[ext] ?? "application/octet-stream";
  const total = buffer.length;
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": access.publicCache
      ? "public, max-age=300"
      : "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };

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
