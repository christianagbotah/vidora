import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { readAudioFile, audioFileExists } from "@/lib/audio-storage";
import {
  shareAccessCookieName,
  verifyShareAccessToken,
} from "@/lib/share-access";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    if (!/^[\w.\-]+$/.test(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }
    if (!/\.(wav|mp3|ogg|m4a)$/i.test(filename)) {
      return NextResponse.json(
        { error: "Only audio files are supported" },
        { status: 400 }
      );
    }

    const audioUrl = `/api/audio/${filename}`;
    const directScene = await db.videoScene.findFirst({
      where: { narrationUrl: audioUrl },
      select: {
        projectId: true,
        project: { select: { id: true, isPublic: true, sharePassword: true } },
      },
    });
    const translation = directScene
      ? null
      : await db.sceneTranslation.findFirst({
          where: { narrationUrl: audioUrl },
          select: {
            scene: {
              select: {
                projectId: true,
                project: {
                  select: { id: true, isPublic: true, sharePassword: true },
                },
              },
            },
          },
        });

    const projectId = directScene?.projectId ?? translation?.scene.projectId;
    const project = directScene?.project ?? translation?.scene.project;
    if (!projectId || !project) {
      return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
    }

    const publiclyShareable = project.isPublic && !project.sharePassword;
    let protectedShareAllowed = false;
    if (project.isPublic && project.sharePassword) {
      const token = req.cookies.get(shareAccessCookieName(project.id))?.value;
      protectedShareAllowed = verifyShareAccessToken(token, project.id);
    }

    if (!publiclyShareable && !protectedShareAllowed) {
      const access = await requireProjectAccess(projectId, false);
      if (!access.ok) return access.response;
    }

    if (!audioFileExists(filename)) {
      return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
    }

    const buffer = await readAudioFile(filename);
    const total = buffer.length;
    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === ".wav"
        ? "audio/wav"
        : ext === ".mp3"
          ? "audio/mpeg"
          : ext === ".ogg"
            ? "audio/ogg"
            : ext === ".m4a"
              ? "audio/mp4"
              : "application/octet-stream";

    const baseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": publiclyShareable
        ? "public, max-age=300"
        : "private, no-store, max-age=0",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    };

    const range = req.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
        });
      }

      const startRaw = match[1];
      const endRaw = match[2];
      let start: number;
      let end: number;

      if (!startRaw && endRaw) {
        const suffixLength = Number.parseInt(endRaw, 10);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
          return new NextResponse(null, {
            status: 416,
            headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
          });
        }
        start = Math.max(0, total - suffixLength);
        end = total - 1;
      } else {
        start = startRaw ? Number.parseInt(startRaw, 10) : 0;
        end = endRaw ? Number.parseInt(endRaw, 10) : total - 1;
      }

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        start >= total ||
        start > end
      ) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
        });
      }

      end = Math.min(total - 1, end);
      const chunk = buffer.subarray(start, end + 1);
      return new NextResponse(Uint8Array.from(chunk), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": chunk.length.toString(),
        },
      });
    }

    return new NextResponse(Uint8Array.from(buffer), {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": total.toString(),
      },
    });
  } catch (error) {
    console.error(
      "[audio serve]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { error: "Failed to serve audio" },
      { status: 500 }
    );
  }
}
