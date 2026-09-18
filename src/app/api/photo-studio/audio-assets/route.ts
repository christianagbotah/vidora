import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { saveGeneratedFile } from "@/lib/generated-store";
import { requireAuth } from "@/lib/project-auth";
import {
  probeTalkingPhotoAudio,
  TALKING_PHOTO_MAX_AUDIO_BYTES,
} from "@/lib/photo-studio-audio";

export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const assets = await db.mediaAsset.findMany({
      where: { userId: auth.session.userId, kind: "audio" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ success: true, assets });
  } catch (error) {
    console.error("[photo-studio audio assets GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load your audio library" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "Upload audio as multipart form data" }, { status: 415 });
    }

    const form = await req.formData();
    const entry = form.get("audio");
    if (!(entry instanceof File) || entry.size <= 0) {
      return NextResponse.json({ success: false, error: "Choose an audio file" }, { status: 400 });
    }
    if (entry.size > TALKING_PHOTO_MAX_AUDIO_BYTES) {
      return NextResponse.json({ success: false, error: "Talking Photo audio must be 50 MB or smaller" }, { status: 413 });
    }

    const buffer = Buffer.from(await entry.arrayBuffer());
    let probe;
    try {
      probe = await probeTalkingPhotoAudio(buffer);
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : "Invalid Talking Photo audio",
      }, { status: 415 });
    }

    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const existing = await db.mediaAsset.findUnique({
      where: { userId_sha256: { userId: auth.session.userId, sha256 } },
    });
    if (existing) {
      if (existing.kind !== "audio") {
        return NextResponse.json({ success: false, error: "This media hash is already stored as another asset type" }, { status: 409 });
      }
      const asset = existing.durationSeconds
        ? existing
        : await db.mediaAsset.update({
            where: { id: existing.id },
            data: { durationSeconds: probe.durationSeconds },
          });
      return NextResponse.json({ success: true, asset, deduplicated: true });
    }

    const url = await saveGeneratedFile(
      `users/${auth.session.userId}/photo-studio/audio/${sha256}.${probe.extension}`,
      buffer,
    );
    const asset = await db.mediaAsset.create({
      data: {
        userId: auth.session.userId,
        kind: "audio",
        source: "upload",
        originalName: (entry.name || `audio.${probe.extension}`).slice(0, 255),
        mimeType: probe.mimeType,
        sizeBytes: entry.size,
        url,
        sha256,
        durationSeconds: probe.durationSeconds,
      },
    });

    return NextResponse.json({ success: true, asset, deduplicated: false }, { status: 201 });
  } catch (error) {
    console.error("[photo-studio audio assets POST]", error);
    return NextResponse.json({ success: false, error: "Failed to upload Talking Photo audio" }, { status: 500 });
  }
}
