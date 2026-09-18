import { createReadStream } from "fs";
import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireProjectAccess } from "@/lib/project-auth";
import { locateGeneratedFile, sanitizeRelPath } from "@/lib/generated-store";
import {
  shareAccessCookieName,
  verifyShareAccessToken,
} from "@/lib/share-access";
import { verifyProviderMediaToken } from "@/lib/provider-media-access";
import { reviewCutProjectId } from "@/lib/review-cut-media";
import { parseSingleByteRange, type ByteRange } from "@/lib/http-byte-range";

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
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
};

type MediaAccess = { allowed: boolean; publicCache: boolean };

function generatedFileStream(filePath: string, range?: ByteRange): ReadableStream<Uint8Array> {
  const nodeStream = range
    ? createReadStream(filePath, { start: range.start, end: range.end })
    : createReadStream(filePath);
  return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
}

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

  // Full Preview review cuts are private and intentionally are not stored in
  // VideoProject.finalVideoUrl. Current filenames include the reviewed cut
  // version and a timestamp so repeated previews never collide:
  //   preview_<projectId>_<cutVersion>_<timestamp>.mp4
  // Legacy preview_<projectId>.mp4 files remain readable as well.
  const reviewProjectId = reviewCutProjectId(rel);
  if (reviewProjectId) {
    const access = await requireProjectAccess(reviewProjectId, false);
    return { allowed: access.ok, publicCache: false };
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
                { previousVideoUrl: mediaUrl },
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

  const file = await locateGeneratedFile(rel);
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const dot = rel.lastIndexOf(".");
  const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : "";
  const contentType = MIME[ext] ?? "application/octet-stream";
  const total = file.size;
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": access.publicCache
      ? "public, max-age=300"
      : "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseSingleByteRange(rangeHeader, total);
    if (!range) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${total}`,
        },
      });
    }

    const length = range.end - range.start + 1;
    return new NextResponse(generatedFileStream(file.path, range), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
        "Content-Length": length.toString(),
      },
    });
  }

  return new NextResponse(generatedFileStream(file.path), {
    status: 200,
    headers: {
      ...baseHeaders,
      "Content-Length": total.toString(),
    },
  });
}
