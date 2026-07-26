import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

/**
 * GET /api/projects/[id]/characters/[characterId]
 * Owner or admin (view) can access.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { id, characterId } = await params;
    const authResult = await requireProjectAccess(id, false);
    if (!authResult.ok) return authResult.response;

    // Verify the character belongs to this project
    const character = await db.character.findFirst({
      where: { id: characterId, projectId: id },
    });
    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, character });
  } catch (error) {
    console.error("Failed to fetch character:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch character" }, { status: 500 });
  }
}

/**
 * PUT /api/projects/[id]/characters/[characterId]
 * Only the project owner can edit characters.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { id, characterId } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    // Verify the character belongs to this project
    const existing = await db.character.findFirst({
      where: { id: characterId, projectId: id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Character not found in this project" }, { status: 404 });
    }

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

/**
 * DELETE /api/projects/[id]/characters/[characterId]
 * Only the project owner can delete characters.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; characterId: string }> }
) {
  try {
    const { id, characterId } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    // Verify the character belongs to this project
    const existing = await db.character.findFirst({
      where: { id: characterId, projectId: id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Character not found in this project" }, { status: 404 });
    }

    await db.character.delete({ where: { id: characterId } });
    return NextResponse.json({ success: true, message: "Character deleted" });
  } catch (error) {
    console.error("Failed to delete character:", error);
    return NextResponse.json({ success: false, error: "Failed to delete character" }, { status: 500 });
  }
}
