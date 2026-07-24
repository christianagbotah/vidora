import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { characterId } = await params;
    const character = await db.character.findUnique({ where: { id: characterId } });
    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, character });
  } catch (error) {
    console.error("Failed to fetch character:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch character" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { characterId } = await params;
    const body = await req.json();
    const { name, role, description, imageUrl, stylePrompt, imageBase64 } = body;

    const character = await db.character.update({
      where: { id: characterId },
      data: {
        ...(name && { name }),
        ...(role && { role }),
        ...(description !== undefined && { description }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(stylePrompt !== undefined && { stylePrompt }),
        ...(imageBase64 !== undefined && { imageBase64 }),
      },
    });

    return NextResponse.json({ success: true, character });
  } catch (error) {
    console.error("Failed to update character:", error);
    return NextResponse.json({ success: false, error: "Failed to update character" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { characterId } = await params;
    await db.character.delete({ where: { id: characterId } });
    return NextResponse.json({ success: true, message: "Character deleted" });
  } catch (error) {
    console.error("Failed to delete character:", error);
    return NextResponse.json({ success: false, error: "Failed to delete character" }, { status: 500 });
  }
}
