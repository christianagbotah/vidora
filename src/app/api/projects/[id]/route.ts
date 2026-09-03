import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { isValidVideoModelId } from "@/lib/video-models";

/**
 * GET /api/projects/[id]
 *
 * Owner: can view their own project
 * Admin: can view any project (read-only oversight)
 * Others: 403
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, false); // view access
    if (!authResult.ok) return authResult.response;

    const project = await db.videoProject.findUnique({
      where: { id },
      include: {
        scenes: {
          orderBy: { sceneNumber: "asc" },
          include: { translations: { orderBy: { lang: "asc" } } },
        },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, project });
  } catch (error) {
    console.error("Failed to fetch project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch project" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/projects/[id]
 *
 * Only the OWNER can edit. Admins cannot edit projects they don't own
 * (prevents accidental modifications to user content).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    const body = await req.json();
    const { title, description, style, aspectRatio, status, targetDuration, videoModel } = body;

    const project = await db.videoProject.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(style && { style }),
        ...(aspectRatio && { aspectRatio }),
        ...(status && { status }),
        ...(targetDuration !== undefined && { targetDuration }),
        // Video engine switch — `null` resets to the default (CogVideoX-3).
        // Unknown ids are rejected so typos can't silently strand a project
        // on a model the transport layer would fall back from anyway.
        ...(videoModel !== undefined && {
          ...(isValidVideoModelId(videoModel) || videoModel === null
            ? { videoModel }
            : {}),
        }),
      },
      include: {
        scenes: {
          orderBy: { sceneNumber: "asc" },
          include: { translations: { orderBy: { lang: "asc" } } },
        },
        characters: true,
      },
    });

    return NextResponse.json({ success: true, project });
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update project" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/[id]
 *
 * Only the OWNER can delete. Admins cannot delete user projects
 * (prevents accidental data loss).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true); // write access
    if (!authResult.ok) return authResult.response;

    await db.videoProject.delete({ where: { id } });
    return NextResponse.json({ success: true, message: "Project deleted" });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete project" },
      { status: 500 }
    );
  }
}
