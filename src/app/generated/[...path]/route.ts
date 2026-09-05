import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireProjectAccess } from "@/lib/project-auth";
import { readGeneratedFile, sanitizeRelPath } from "@/lib/generated-store";
import {
  shareAccessCookieName,
  verifyShareAccessToken,
} from "@/lib/share-access";
import { verifyProviderMediaToken } from "@/lib/provider-media-access";

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

async function authorizeGeneratedMedia(
  req: NextRequest,
  rel: string
): Promise<MediaAccess> {
  // Watermarked acquisition previews contain no private project data.
  if (rel.startsWith("previews/")) {
    return { allowed: true, publicCache: true };
  }

  // External rendering providers cannot carry the user's Vidora session.
  // A short-lived HMAC capability grants read access to exactly this file.
  if (verifyProviderMediaToken(
    rel,
    req.nextUrl.searchParams.get("vpm_exp"),
    req.nextUrl.searchParams.get("vpm_sig")
  )) {
    return { allowed: true, publicCache: false };
  }

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
    select: {
      id: true,
      isPublic: true,
      sharePassword: true,
    },
  });

  if (project) {
    if (project.isPublic && !project.sharePassword) {
      return { allowed: true, publicCache: true };
    }

    if (project.isPublic && project.sharePassword) {
      const token = req.cookies.get(shareAccessCookieName(project.id))?.value;
      if (verifyShareAccessToken(token, project.id)) {
        return { allowed: true, publicCache: false };
      }
    }

    // Owners/admins can still access the media through their authenticated
    // account even when a public-share password is configured.
    const access = await requireProjectAccess(project.id, false);
    return { allowed: access.ok, publicCache: false };
  }

  const brand = await db.brandKit.findFirst({
    where: { logoUrl: mediaUrl },
    select: { userId: true },
  });
  if (brand) {
    const auth = await requireAuth();
    if (!auth.ok) return { allowed: false, publicCache: false };
    return {
      allowed:
        auth.session.userId === brand.userId || auth.session.role === "admin",
      publicCache: false,
    };
  }

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

  const access = await authorizeGeneratedMedia(req, rel);
  if (!access.allowed) {
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

      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start >= total ||
        start > end
      ) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      start = Math.max(0, start);
      end = Math.min(total - 1, end);

      const chunk = buffer.subarray(start, end + 1);
      const responseChunk = Uint8Array.from(chunk);
      return new NextResponse(responseChunk, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": chunk.length.toString(),
        },
      });
    }
  }

  const responseBody = Uint8Array.from(buffer);
  return new NextResponse(responseBody, {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": total.toString(),
    },
  });
}
