import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import bcrypt from "bcryptjs";

/**
 * GET /api/projects/[id]/share
 * Returns the project's current sharing settings.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Allow read access for guest demo projects (userId === null) too.
    const authResult = await requireProjectAccess(id, false);
    if (!authResult.ok) return authResult.response;

    const project = await db.videoProject.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const shareUrl = project.shareSlug ? `${baseUrl}/share/${project.shareSlug}` : null;
    return NextResponse.json({
      success: true,
      settings: {
        isPublic: project.isPublic,
        shareSlug: project.shareSlug,
        hasPassword: !!project.sharePassword,
        allowEmbed: project.allowEmbed,
        shareUrl,
      },
    });
  } catch (error) {
    console.error("[share GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load share settings" }, { status: 500 });
  }
}

/**
 * POST /api/projects/[id]/share
 * Updates the project's sharing settings.
 * Body: { isPublic?: boolean, shareSlug?: string, password?: string, allowEmbed?: boolean }
 *
 * Guests can share demo projects (userId === null) — each demo is ephemeral
 * and per-click, so letting the guest toggle sharing on it is safe and makes
 * the demo fully interactive.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireProjectAccess(id, true);
    if (!authResult.ok) return authResult.response;

    const project = await db.videoProject.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const body = await req.json();
    const { isPublic, shareSlug, password, allowEmbed } = body;

    const update: Record<string, unknown> = {};
    if (typeof isPublic === "boolean") update.isPublic = isPublic;
    if (typeof allowEmbed === "boolean") update.allowEmbed = allowEmbed;

    // Handle slug
    if (isPublic) {
      let slug = typeof shareSlug === "string" ? shareSlug.trim() : "";
      if (!slug) {
        // Auto-generate a random 8-char slug
        slug = Math.random().toString(36).slice(2, 10);
      }
      // Check slug uniqueness (exclude current project)
      const existing = await db.videoProject.findFirst({
        where: { shareSlug: slug, NOT: { id } },
      });
      if (existing) {
        return NextResponse.json({ success: false, error: "This share URL is already taken. Try another." }, { status: 409 });
      }
      update.shareSlug = slug;
    }

    // Handle password
    if (password !== undefined) {
      if (typeof password === "string" && password.trim().length > 0) {
        update.sharePassword = await bcrypt.hash(password.trim(), 10);
      } else {
        // Empty string or null = remove password
        update.sharePassword = null;
      }
    }

    const updated = await db.videoProject.update({ where: { id }, data: update });
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    return NextResponse.json({
      success: true,
      settings: {
        isPublic: updated.isPublic,
        shareSlug: updated.shareSlug,
        hasPassword: !!updated.sharePassword,
        allowEmbed: updated.allowEmbed,
        shareUrl: updated.shareSlug ? `${baseUrl}/share/${updated.shareSlug}` : null,
      },
    });
  } catch (error) {
    console.error("[share POST]", error);
    return NextResponse.json({ success: false, error: "Failed to update share settings" }, { status: 500 });
  }
}
