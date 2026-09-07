import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { chooseAutoCharacterVoice } from "@/lib/character-voice-casting";

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function activeExportResponse(error: unknown): NextResponse | null {
  if (!errorText(error).includes("VIDORA_EXPORT_ACTIVE")) return null;
  return NextResponse.json(
    {
      success: false,
      error: "Characters cannot be added while an export is queued or running. Wait for the export to finish, then preview again.",
      code: "VIDORA_EXPORT_ACTIVE",
    },
    { status: 409 },
  );
}

/**
 * GET /api/projects/[id]/characters
 * Returns characters for a project. Owner or admin (view) can access.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, false);
    if (!authResult.ok) return authResult.response;

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

/**
 * POST /api/projects/[id]/characters
 * Creates a new character. Only the project owner can add characters.
 *
 * A character without an explicit Voice Studio assignment is automatically
 * cast to a stable non-narrator logical voice. This prevents manually added
 * dialogue speakers from silently inheriting the narrator voice.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const body = await req.json();
    const { name, role, description, imageUrl, stylePrompt, voiceId } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: "Character name is required" }, { status: 400 });
    }

    const explicitVoice = typeof voiceId === "string" && voiceId.trim() ? voiceId.trim() : null;
    const existingVoices = explicitVoice
      ? []
      : await db.character.findMany({
          where: { projectId: id, voiceId: { not: null } },
          select: { voiceId: true },
        });
    const usedVoices = new Set(
      existingVoices
        .map((character) => character.voiceId?.trim().toLocaleLowerCase())
        .filter((voice): voice is string => Boolean(voice)),
    );
    const resolvedVoice = explicitVoice || chooseAutoCharacterVoice(
      {
        name: String(name),
        role: typeof role === "string" ? role : "supporting",
        description: typeof description === "string" ? description : null,
        stylePrompt: typeof stylePrompt === "string" ? stylePrompt : null,
      },
      usedVoices,
    );

    const character = await db.character.create({
      data: {
        projectId: id,
        name,
        role: role || "supporting",
        description: description || null,
        imageUrl: imageUrl || null,
        stylePrompt: stylePrompt || null,
        voiceId: resolvedVoice,
      },
    });

    return NextResponse.json({ success: true, character }, { status: 201 });
  } catch (error) {
    const guarded = activeExportResponse(error);
    if (guarded) return guarded;
    console.error("Failed to create character:", error);
    return NextResponse.json({ success: false, error: "Failed to create character" }, { status: 500 });
  }
}
