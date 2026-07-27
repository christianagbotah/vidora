import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";

/**
 * GET /api/projects
 *
 * - Regular users: see only THEIR projects
 * - Admins: see ALL projects (for oversight/monitoring)
 */
export async function GET() {
  try {
    const authResult = await requireAuth();
    if (!authResult.ok) {
      // Guests get an empty list instead of 401 — they simply have no projects
      return NextResponse.json({ success: true, projects: [] });
    }

    const { userId, role } = authResult.session;

    // Admins see all projects; regular users see only their own
    const where = role === "admin" ? {} : { userId };

    const projects = await db.videoProject.findMany({
      where,
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, projects });
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects
 *
 * Creates a new project owned by the authenticated user.
 * The userId is ALWAYS taken from the session (never from the request body)
 * to prevent users from creating projects under someone else's account.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (!authResult.ok) return authResult.response;

    const { userId } = authResult.session;
    const body = await req.json();
    const { title, description, style, aspectRatio, projectType, characters } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Title is required" },
        { status: 400 }
      );
    }

    const project = await db.videoProject.create({
      data: {
        // ── CRITICAL: bind the project to the authenticated user ──
        userId,
        title,
        description: description || null,
        style: style || "cinematic",
        aspectRatio: aspectRatio || "16:9",
        targetDuration: body.targetDuration || 60,
        projectType: projectType || "custom",
        characters: characters?.length
          ? { create: characters.map((c: Record<string, string>) => ({
              name: c.name,
              role: c.role || "supporting",
              description: c.description || null,
              stylePrompt: c.stylePrompt || null,
              imageUrl: c.imageUrl || null,
            })) }
          : undefined,
      },
      include: { scenes: true, characters: true },
    });

    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create project" },
      { status: 500 }
    );
  }
}
