import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { readAudioFile, audioFileExists } from "@/lib/audio-storage";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    if (!/^[\w.\-]+$/.test(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }
    if (!/\.(wav|mp3|ogg|m4a)$/i.test(filename)) {
      return NextResponse.json({ error: "Only audio files are supported" }, { status: 400 });
    }

    const audioUrl = `/api/audio/${filename}`;
    const directScene = await db.videoScene.findFirst({
      where: { narrationUrl: audioUrl },
      select: {
        projectId: true,
        project: { select: { isPublic: true, sharePassword: true } },
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
                project: { select: { isPublic: true, sharePassword: true } },
              },
            },
          },
        });

    const projectId = directScene?.projectId ?? translation?.scene.projectId;
    const project = directScene?.project ?? translation?.scene.project;
    if (!projectId || !project) {
      // Do not expose orphaned files simply because a filename is guessed.
      return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
    }

    const publiclyShareable = project.isPublic && !project.sharePassword;
    if (!publiclyShareable) {
      const access = await requireProjectAccess(projectId, false);
      if (!access.ok) return access.response;
    }

    if (!audioFileExists(filename)) {
      return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
    }
    const buffer = await readAudioFile(filename);

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === ".wav" ? "audio/wav" :
      ext === ".mp3" ? "audio/mpeg" :
      ext === ".ogg" ? "audio/ogg" :
      ext === ".m4a" ? "audio/mp4" :
      "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": publiclyShareable
          ? "public, max-age=300"
          : "private, no-store, max-age=0",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      "[audio serve]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "Failed to serve audio" }, { status: 500 });
  }
}
