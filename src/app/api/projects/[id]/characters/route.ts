import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const characters = await db.character.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ success: true, characters });
  } catch (error) {
    console.error("Failed to fetch characters:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch characters" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, role, description, imageUrl, stylePrompt } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: "Character name is required" }, { status: 400 });
    }

    const character = await db.character.create({
      data: {
        projectId: id,
        name,
        role: role || "supporting",
        description: description || null,
        imageUrl: imageUrl || null,
        stylePrompt: stylePrompt || null,
      },
    });

    return NextResponse.json({ success: true, character }, { status: 201 });
  } catch (error) {
    console.error("Failed to create character:", error);
    return NextResponse.json({ success: false, error: "Failed to create character" }, { status: 500 });
  }
}
