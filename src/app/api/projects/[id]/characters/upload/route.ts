import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    const characterId = formData.get("characterId") as string | null;

    if (!imageFile) {
      return NextResponse.json({ success: false, error: "No image file provided" }, { status: 400 });
    }

    if (!characterId) {
      return NextResponse.json({ success: false, error: "Character ID is required" }, { status: 400 });
    }

    // Verify character belongs to project
    const character = await db.character.findUnique({ where: { id: characterId } });
    if (!character || character.projectId !== projectId) {
      return NextResponse.json({ success: false, error: "Character not found in this project" }, { status: 404 });
    }

    // Save image file
    const outputDir = path.join(process.cwd(), "public", "generated", "characters");
    await mkdir(outputDir, { recursive: true });

    const bytes = await imageFile.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Determine extension from mime type
    const mimeToExt: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const ext = mimeToExt[imageFile.type] || "png";
    const filename = `char_${characterId.slice(0, 8)}_${Date.now()}.${ext}`;
    const filepath = path.join(outputDir, filename);
    await writeFile(filepath, buffer);

    const imageUrl = `/generated/characters/${filename}`;

    // Also store base64 for SDK image_url usage
    const imageBase64 = buffer.toString("base64");

    // Update character
    const updated = await db.character.update({
      where: { id: characterId },
      data: { imageUrl, imageBase64 },
    });

    return NextResponse.json({
      success: true,
      character: updated,
      imageUrl,
    });
  } catch (error) {
    console.error("Failed to upload character image:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: "Failed to upload: " + message }, { status: 500 });
  }
}
