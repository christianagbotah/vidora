import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requireProjectAccess } from "@/lib/project-auth";
import { isValidVideoModelId } from "@/lib/video-models";
import {
  createDraftDescription,
  DRAFT_CHARACTER_VOICES,
  normalizedCharacterName,
  persistDraftCharacterImages,
  sanitizeCreateDraftSnapshot,
} from "@/lib/create-draft-server";

export const runtime = "nodejs";

function targetDuration(snapshot: ReturnType<typeof sanitizeCreateDraftSnapshot>): number {
  if (!snapshot.isCustomDuration) return snapshot.selectedDuration;
  const parsed = Number.parseInt(snapshot.customDuration, 10);
  return Number.isFinite(parsed) ? Math.max(10, Math.min(300, parsed)) : snapshot.selectedDuration;
}

function imageForCharacter(images: Record<string, string>, name: string): string | null {
  const wanted = normalizedCharacterName(name);
  for (const [imageName, url] of Object.entries(images)) {
    if (normalizedCharacterName(imageName) === wanted) return url;
  }
  return null;
}

async function syncDraftCharacters(
  projectId: string,
  snapshot: ReturnType<typeof sanitizeCreateDraftSnapshot>,
) {
  const existing = await db.character.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  const byName = new Map(existing.map((character) => [normalizedCharacterName(character.name), character]));
  const usedVoiceIds = new Set(existing.map((character) => character.voiceId).filter((voice): voice is string => !!voice));

  for (let index = 0; index < snapshot.parsedCharacters.length; index++) {
    const character = snapshot.parsedCharacters[index];
    const key = normalizedCharacterName(character.name);
    const current = byName.get(key);
    const persistedImage = imageForCharacter(snapshot.preCharImages, character.name);

    if (current) {
      await db.character.update({
        where: { id: current.id },
        data: {
          name: character.name,
          role: character.role || "supporting",
          description: character.description || null,
          stylePrompt: character.stylePrompt || null,
          ...(persistedImage ? { imageUrl: persistedImage } : {}),
          updatedAt: new Date(),
        },
      });
      continue;
    }

    const isNarrator = /narrator/i.test(character.name) || character.role.toLowerCase() === "narrator";
    let voiceId = isNarrator ? "tongtong" : null;
    if (!voiceId) {
      const unused = DRAFT_CHARACTER_VOICES.find((voice) => !usedVoiceIds.has(voice));
      voiceId = unused || DRAFT_CHARACTER_VOICES[index % DRAFT_CHARACTER_VOICES.length];
    }
    usedVoiceIds.add(voiceId);

    const created = await db.character.create({
      data: {
        projectId,
        name: character.name,
        role: character.role || "supporting",
        description: character.description || null,
        stylePrompt: character.stylePrompt || null,
        imageUrl: persistedImage,
        voiceId,
      },
    });
    byName.set(key, created);
  }
}

/**
 * GET /api/projects/draft?projectId=<id>
 *
 * With projectId, returns that owner's resumable draft. Without an id,
 * returns the authenticated user's most recently autosaved unfinished draft.
 */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
    if (projectId) {
      const access = await requireProjectAccess(projectId, false);
      if (!access.ok) return access.response;
      const project = await db.videoProject.findUnique({
        where: { id: projectId },
        include: {
          scenes: { orderBy: { sceneNumber: "asc" } },
          characters: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!project || !project.draftData) {
        return NextResponse.json({ success: false, error: "Draft not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, project });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const project = await db.videoProject.findFirst({
      where: {
        userId: auth.session.userId,
        status: "draft",
        draftData: { not: null },
      },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { lastAutosavedAt: "desc" },
    });
    return NextResponse.json({ success: true, project: project || null });
  } catch (error) {
    console.error("[project-draft] GET failed", error);
    return NextResponse.json({ success: false, error: "Failed to load project draft" }, { status: 500 });
  }
}

/**
 * POST /api/projects/draft
 *
 * Creates the durable project record on the first titled autosave, then
 * updates the same row on subsequent saves. Any base64 character portraits
 * are moved to generated-store before the JSON snapshot is persisted.
 */
export async function POST(req: NextRequest) {
  let newlyCreatedProjectId: string | null = null;
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 500) : "";
    if (!title) {
      return NextResponse.json({ success: false, error: "Project title is required before autosave starts" }, { status: 400 });
    }

    const snapshot = sanitizeCreateDraftSnapshot(body.snapshot);
    const requestedProjectId = typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;

    let projectId = requestedProjectId;
    let created = false;

    if (projectId) {
      const access = await requireProjectAccess(projectId, true);
      if (!access.ok) return access.response;
      const existing = await db.videoProject.findUnique({ where: { id: projectId }, select: { status: true } });
      if (!existing) {
        return NextResponse.json({ success: false, error: "Project draft not found" }, { status: 404 });
      }
      if (existing.status !== "draft") {
        return NextResponse.json({ success: false, error: "This project is no longer an editable creation draft" }, { status: 409 });
      }
    } else {
      const initial = await db.videoProject.create({
        data: {
          userId: auth.session.userId,
          title,
          description: createDraftDescription(snapshot),
          style: snapshot.selectedStyle,
          aspectRatio: snapshot.selectedAspect,
          targetDuration: targetDuration(snapshot),
          projectType: snapshot.projectType,
          status: "draft",
          ...(isValidVideoModelId(snapshot.selectedModel) ? { videoModel: snapshot.selectedModel } : {}),
        },
      });
      projectId = initial.id;
      newlyCreatedProjectId = initial.id;
      created = true;
    }

    const persistedSnapshot = await persistDraftCharacterImages(projectId, snapshot);
    await db.videoProject.update({
      where: { id: projectId },
      data: {
        title,
        description: createDraftDescription(persistedSnapshot),
        style: persistedSnapshot.selectedStyle,
        aspectRatio: persistedSnapshot.selectedAspect,
        targetDuration: targetDuration(persistedSnapshot),
        projectType: persistedSnapshot.projectType,
        status: "draft",
        draftData: JSON.stringify(persistedSnapshot),
        lastAutosavedAt: new Date(),
        ...(isValidVideoModelId(persistedSnapshot.selectedModel)
          ? { videoModel: persistedSnapshot.selectedModel }
          : {}),
      },
    });

    await syncDraftCharacters(projectId, persistedSnapshot);

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json({
      success: true,
      projectId,
      created,
      autosavedAt: project?.lastAutosavedAt?.toISOString() || new Date().toISOString(),
      snapshot: persistedSnapshot,
      project,
    }, { status: created ? 201 : 200 });
  } catch (error) {
    console.error("[project-draft] POST failed", error);
    // Do not leave a title-only ghost project if the first autosave failed
    // before the durable snapshot could be written.
    if (newlyCreatedProjectId) {
      await db.videoProject.delete({ where: { id: newlyCreatedProjectId } }).catch(() => {});
    }
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: detail.includes("Draft is too large") ? detail : "Failed to autosave project draft" },
      { status: detail.includes("Draft is too large") ? 413 : 500 },
    );
  }
}
