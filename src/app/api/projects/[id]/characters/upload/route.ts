import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * POST /api/projects/[id]/characters/upload
 *
 * Uploads an image for a character (multipart/form-data).
 * Body fields:
 *   - image: File (the image to upload)
 *   - characterId: string (the character to update)
 *
 * The image is saved to disk at public/generated/characters/ and the
 * resulting URL is stored on the character record (imageUrl + imageBase64).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    const characterId = formData.get("characterId") as string | null;

    if (!imageFile) {
      return NextResponse.json(
        { success: false, error: "No image file provided" },
        { status: 400 }
      );
    }
    if (!characterId) {
      return NextResponse.json(
        { success: false, error: "Character ID is required" },
        { status: 400 }
      );
    }

    // Verify the character belongs to this project
    const character = await db.character.findFirst({
      where: { id: characterId, projectId: id },
    });
    if (!character) {
      return NextResponse.json(
        { success: false, error: "Character not found in this project" },
        { status: 404 }
      );
    }

    // Read file into buffer
    const bytes = await imageFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");

    // Save to disk
    const outputDir = path.join(process.cwd(), "public", "generated", "characters");
    await mkdir(outputDir, { recursive: true });
    const ext = imageFile.name.split(".").pop()?.toLowerCase() || "png";
    const safeExt = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? ext : "png";
    const filename = `char_${characterId.slice(0, 8)}_${crypto.randomBytes(4).toString("hex")}_${Date.now()}.${safeExt}`;
    await writeFile(path.join(outputDir, filename), buffer);

    const imageUrl = `/generated/characters/${filename}`;

    // Update the character record
    const updated = await db.character.update({
      where: { id: characterId },
      data: {
        imageUrl,
        imageBase64: base64,
      },
    });

    return NextResponse.json({
      success: true,
      character: updated,
      imageUrl,
    });
  } catch (error) {
    console.error("Failed to upload character image:", error);
    return NextResponse.json(
      { success: false, error: "Failed to upload character image" },
      { status: 500 }
    );
  }
}
