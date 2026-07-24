import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    const characterId = formData.get("characterId") as string | null;

    if (!imageFile) {
      return NextResponse.json({ success: false, error: "Image file is required" }, { status: 400 });
    }
    if (!characterId) {
      return NextResponse.json({ success: false, error: "Character ID is required" }, { status: 400 });
    }

    // Verify character exists
    const character = await db.character.findUnique({
      where: { id: characterId, projectId: id },
    });
    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found" }, { status: 404 });
    }

    const outputDir = path.join(process.cwd(), "public", "generated", "characters");
    await mkdir(outputDir, { recursive: true });

    const bytes = await imageFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = imageFile.name.split(".").pop() || "png";
    const filename = `upload_${characterId.slice(0, 8)}_${Date.now()}.${ext}`;
    await writeFile(path.join(outputDir, filename), buffer);

    const imageUrl = `/generated/characters/${filename}`;
    const imageBase64 = buffer.toString("base64");

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
    return NextResponse.json({ success: false, error: "Failed to upload character image" }, { status: 500 });
  }
}
