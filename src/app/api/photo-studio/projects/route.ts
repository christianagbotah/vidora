import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import {
  buildPhotoScenePrompt,
  normalizeAssetIds,
  sanitizeAspectRatio,
  sanitizePhotoStudioMode,
  sanitizePhotoStudioTitle,
  sanitizeSecondsPerPhoto,
  sanitizeTransition,
} from "@/lib/photo-studio";

export const runtime = "nodejs";

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, max);
  return normalized || null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const assetIds = normalizeAssetIds(body.assetIds);
    if (!assetIds.length) {
      return NextResponse.json({ success: false, error: "Select at least one uploaded photo" }, { status: 400 });
    }

    const assets = await db.mediaAsset.findMany({
      where: { userId: auth.session.userId, id: { in: assetIds }, kind: "image" },
    });
    if (assets.length !== assetIds.length) {
      return NextResponse.json({ success: false, error: "One or more selected photos are unavailable" }, { status: 404 });
    }
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const orderedAssets = assetIds.map((id) => byId.get(id)!).filter(Boolean);

    const characterProfileId = optionalText(body.characterProfileId, 200);
    const profile = characterProfileId
      ? await db.characterProfile.findFirst({
          where: {
            id: characterProfileId,
            userId: auth.session.userId,
            consentStatus: "confirmed",
          },
          include: { primaryAsset: true },
        })
      : null;
    if (characterProfileId && !profile) {
      return NextResponse.json(
        { success: false, error: "The selected reusable character is unavailable or missing consent" },
        { status: 404 },
      );
    }

    const title = sanitizePhotoStudioTitle(body.title);
    const mode = sanitizePhotoStudioMode(body.mode);
    const aspectRatio = sanitizeAspectRatio(body.aspectRatio);
    const transition = sanitizeTransition(body.transition);
    const secondsPerPhoto = sanitizeSecondsPerPhoto(body.secondsPerPhoto);
    const style = optionalText(body.style, 120) || "cinematic";
    const targetDuration = Math.min(300, secondsPerPhoto * orderedAssets.length);

    const project = await db.$transaction(async (tx) => {
      const created = await tx.videoProject.create({
        data: {
          userId: auth.session.userId,
          title,
          description: mode === "slideshow"
            ? "Created in Vidora Photo Studio as a reference-backed cinematic slideshow."
            : "Created in Vidora Photo Studio as a reference-backed photo animation project.",
          style,
          aspectRatio,
          targetDuration,
          projectType: mode === "slideshow" ? "photo-slideshow" : "photo-animation",
          status: "draft",
        },
      });

      let projectCharacterId: string | null = null;
      if (profile) {
        const projectCharacter = await tx.character.create({
          data: {
            projectId: created.id,
            sourceProfileId: profile.id,
            name: profile.name,
            role: profile.role || "primary",
            description: profile.description,
            stylePrompt: profile.stylePrompt,
            voiceId: profile.voiceId,
            imageUrl: profile.primaryAsset?.url || null,
          },
        });
        projectCharacterId = projectCharacter.id;
      }

      for (let index = 0; index < orderedAssets.length; index++) {
        const asset = orderedAssets[index];
        await tx.videoScene.create({
          data: {
            projectId: created.id,
            sceneNumber: index + 1,
            title: `Photo ${index + 1}`,
            prompt: buildPhotoScenePrompt(mode, index, orderedAssets.length, profile?.name),
            visualNote: mode === "slideshow"
              ? "Preserve the source photo; favor subtle depth, parallax and restrained camera movement."
              : "Preserve identity and composition while introducing believable natural motion.",
            characterIds: projectCharacterId ? JSON.stringify([projectCharacterId]) : null,
            referenceImageUrl: asset.url,
            imageUrl: asset.url,
            duration: secondsPerPhoto,
            transition,
            status: "pending",
          },
        });
      }

      return created;
    });

    return NextResponse.json({
      success: true,
      projectId: project.id,
      sceneCount: orderedAssets.length,
      mode,
      generationRequired: true,
      message: mode === "slideshow"
        ? "Your cinematic slideshow storyboard is ready. Review it in Vidora, then generate motion when you are ready to spend credits."
        : "Your reference-backed photo animation project is ready. Review it before starting paid motion generation.",
      dashboardUrl: "/?view=dashboard",
    }, { status: 201 });
  } catch (error) {
    console.error("[photo-studio projects POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create the Photo Studio project" }, { status: 500 });
  }
}
