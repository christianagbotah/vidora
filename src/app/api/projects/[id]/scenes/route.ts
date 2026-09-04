import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

/**
 * GET /api/projects/[id]/scenes
 * Returns scenes for a project. Owner or admin (view) can access.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, false);
    if (!authResult.ok) return authResult.response;

    const scenes = await db.videoScene.findMany({
      where: { projectId: id },
      orderBy: { sceneNumber: "asc" },
    });
    return NextResponse.json({ success: true, scenes });
  } catch (error) {
    console.error("Failed to fetch scenes:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch scenes" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects/[id]/scenes
 * Creates a new scene. Only the project owner can add scenes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    const body = await req.json();
    const { prompt, enhancedPrompt, duration, transition, characterIds, characterNames, dialogue, visualNote, musicTrackUrl, musicMood, musicVolume } = body;

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }

    // ── Resolve scene ↔ character linkage ──
    // Accept either explicit character IDs (array or JSON string) or
    // character NAMES (resolved against this project's characters).
    // Without this linkage, character portraits/descriptions can never be
    // used as reference for the scene's video + image generation.
    const resolvedIds = new Set<string>();

    const rawIds = characterIds;
    if (typeof rawIds === "string") {
      try {
        const parsed = JSON.parse(rawIds);
        if (Array.isArray(parsed)) parsed.forEach((id: unknown) => typeof id === "string" && resolvedIds.add(id));
      } catch { /* ignore */ }
    } else if (Array.isArray(rawIds)) {
      rawIds.forEach((id: unknown) => typeof id === "string" && resolvedIds.add(id));
    }

    let linkedCharacterIds: string | null = null;
    const needsNameResolution =
      Array.isArray(characterNames) && characterNames.length > 0 && resolvedIds.size === 0;

    if (needsNameResolution || resolvedIds.size > 0) {
      const projectCharacters = await db.character.findMany({
        where: { projectId: id },
        select: { id: true, name: true },
      });
      if (Array.isArray(characterNames)) {
        const names = (characterNames as string[])
          .map((n) => (typeof n === "string" ? n.trim().toLowerCase() : ""))
          .filter(Boolean);
        for (const ch of projectCharacters) {
          if (names.includes(ch.name.trim().toLowerCase())) resolvedIds.add(ch.id);
        }
      }
    }

    if (resolvedIds.size > 0) {
      linkedCharacterIds = JSON.stringify([...resolvedIds]);
    }

    // Get the next scene number
    const existingScenes = await db.videoScene.findMany({
      where: { projectId: id },
      orderBy: { sceneNumber: "desc" },
      take: 1,
    });
    const nextSceneNumber =
      existingScenes.length > 0 ? existingScenes[0].sceneNumber + 1 : 1;

    const scene = await db.videoScene.create({
      data: {
        projectId: id,
        sceneNumber: nextSceneNumber,
        prompt,
        enhancedPrompt: enhancedPrompt || null,
        // Dialogue drives the auto TTS voices at generation time and the
        // export voice mix — dropping it here silently muted every character.
        dialogue: typeof dialogue === "string" && dialogue.trim() ? dialogue : null,
        visualNote: typeof visualNote === "string" && visualNote.trim() ? visualNote : null,
        duration: duration || 3,
        transition: transition || "fade",
        characterIds: linkedCharacterIds,
        // Smart defaults: the script analyzer may pre-assign a background
        // music track (celebration scripts get a matching mood).
        musicTrackUrl: typeof musicTrackUrl === "string" && musicTrackUrl ? musicTrackUrl : null,
        musicMood: typeof musicMood === "string" && musicMood ? musicMood : null,
        ...(typeof musicVolume === "number" && !Number.isNaN(musicVolume)
          ? { musicVolume: Math.max(0, Math.min(100, Math.round(musicVolume))) }
          : {}),
      },
    });

    return NextResponse.json({ success: true, scene }, { status: 201 });
  } catch (error) {
    console.error("Failed to create scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create scene" },
      { status: 500 }
    );
  }
}
