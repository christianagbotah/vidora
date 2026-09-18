import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { MediaAsset } from "@prisma/client";
import { db } from "@/lib/db";
import { saveGeneratedFile } from "@/lib/generated-store";
import { requireAuth } from "@/lib/project-auth";
import {
  detectImageExtension,
  PHOTO_STUDIO_MAX_IMAGE_BYTES,
  PHOTO_STUDIO_MAX_UPLOADS,
} from "@/lib/photo-studio";

export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const assets = await db.mediaAsset.findMany({
      where: { userId: auth.session.userId, kind: "image" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ success: true, assets });
  } catch (error) {
    console.error("[photo-studio assets GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load your media library" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "Upload images as multipart form data" }, { status: 415 });
    }

    const form = await req.formData();
    const files = form.getAll("images").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    if (!files.length) {
      return NextResponse.json({ success: false, error: "Choose at least one image" }, { status: 400 });
    }
    if (files.length > PHOTO_STUDIO_MAX_UPLOADS) {
      return NextResponse.json(
        { success: false, error: `Upload at most ${PHOTO_STUDIO_MAX_UPLOADS} images at once` },
        { status: 400 },
      );
    }

    const assets: MediaAsset[] = [];
    for (const file of files) {
      if (file.size > PHOTO_STUDIO_MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { success: false, error: `${file.name || "Image"} is larger than 15 MB` },
          { status: 413 },
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = detectImageExtension(buffer, file.type);
      if (!ext) {
        return NextResponse.json(
          { success: false, error: `${file.name || "Image"} must be a real PNG, JPEG, or WebP image` },
          { status: 415 },
        );
      }
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      const url = await saveGeneratedFile(
        `users/${auth.session.userId}/photo-studio/${sha256}.${ext}`,
        buffer,
      );
      const asset = await db.mediaAsset.upsert({
        where: {
          userId_sha256: {
            userId: auth.session.userId,
            sha256,
          },
        },
        update: {},
        create: {
          userId: auth.session.userId,
          kind: "image",
          source: "upload",
          originalName: (file.name || `photo.${ext}`).slice(0, 255),
          mimeType: file.type,
          sizeBytes: file.size,
          url,
          sha256,
        },
      });
      assets.push(asset);
    }

    return NextResponse.json({ success: true, assets }, { status: 201 });
  } catch (error) {
    console.error("[photo-studio assets POST]", error);
    return NextResponse.json({ success: false, error: "Failed to upload photo assets" }, { status: 500 });
  }
}
