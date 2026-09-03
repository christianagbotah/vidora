import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { saveGeneratedFile } from "@/lib/generated-store";
import { isValidVideoModelId } from "@/lib/video-models";
import crypto from "crypto";

/**
 * GET /api/projects
 *
 * - Regular users: see only THEIR projects
 * - Admins: see ALL projects (for oversight/monitoring)
 */

export const runtime = "nodejs";

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
 *
 * Supports optional `imageBase64` on each character — when provided,
 * the image is saved to disk and the resulting URL is stored in the DB.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth();
    if (!authResult.ok) return authResult.response;

    const { userId } = authResult.session;
    const body = await req.json();
    const { title, description, style, aspectRatio, projectType, characters, videoModel } = body;

    if (!title) {
      return NextResponse.json(
        { success: false, error: "Title is required" },
        { status: 400 }
      );
    }

    // ── Pre-process character images ──
    // If a character has imageBase64, save it to disk and compute the URL
    const processedCharacters = characters?.length
      ? await Promise.all(
          characters.map(async (c: Record<string, string>) => {
            const result: Record<string, string> = {
              name: c.name,
              role: c.role || "supporting",
              description: c.description || null,
              stylePrompt: c.stylePrompt || null,
              imageUrl: c.imageUrl || null,
            };

            if (c.imageBase64) {
              try {
                // Strip data URL prefix if present
                const raw = c.imageBase64.includes(",")
                  ? c.imageBase64.split(",")[1]
                  : c.imageBase64;
                const buffer = Buffer.from(raw, "base64");
                const filename = `char_${crypto.randomBytes(4).toString("hex")}_${Date.now()}.png`;
                result.imageUrl = await saveGeneratedFile(`characters/${filename}`, buffer);
              } catch (err) {
                console.error(`Failed to save character image for ${c.name}:`, err);
                // Continue without image — non-fatal
              }
            }

            return result;
          })
        )
      : undefined;

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
        // Video engine selection — null/undefined falls back to CogVideoX-3.
        // Unknown ids are dropped (silently defaulting) so a bad client value
        // can never break project creation.
        ...(isValidVideoModelId(videoModel) ? { videoModel } : {}),
        characters: processedCharacters?.length
          ? { create: processedCharacters }
          : undefined,
      },
      include: { scenes: true, characters: true },
    });

    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to create project", adminDetail: message },
      { status: 500 }
    );
  }
}
