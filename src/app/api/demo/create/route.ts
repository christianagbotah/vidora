import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_TEMPLATES, getDemoTemplate, getDemoFinalVideo } from "@/lib/demo-templates";

/**
 * POST /api/demo/create
 *
 * Creates a fully-populated DEMO project in the database.
 *
 * - Costs ZERO tokens (no token deduction)
 * - Makes ZERO Z.ai API calls
 * - Pre-fills every scene with a real image URL + video URL + status="completed"
 * - Works for authenticated users (associates project with their account)
 *   AND for guests (creates project with userId=null so they can still
 *   explore the studio)
 *
 * The demo project is a real DB record, so it shows up in the Gallery and
 * behaves exactly like a real generated project in the Studio — playable
 * videos, scene list, AI Director controls, the works.
 *
 * Body: { templateId?: string }  (defaults to the first template)
 */
export async function POST(req: NextRequest) {
  try {
    let templateId: string | null = null;
    try {
      const body = await req.json();
      templateId = body?.templateId ?? null;
    } catch {
      // Body is optional / may be empty — that's fine
    }

    const template = getDemoTemplate(templateId);

    // Resolve the user if logged in. Guests get userId=null so they can
    // still play with the demo without signing up first.
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      if (session?.user) {
        userId = (session.user as Record<string, unknown>).id as string;
      }
    } catch {
      // Auth not configured / no session — proceed as guest
    }

    // Create the project
    const project = await db.videoProject.create({
      data: {
        userId,
        title: template.title,
        description: template.description,
        style: template.style,
        aspectRatio: template.aspectRatio,
        targetDuration: template.targetDuration,
        projectType: template.projectType,
        status: "completed",
        finalVideoUrl: getDemoFinalVideo(template.id),
      },
    });

    // Create all scenes with pre-filled assets + completed status
    // Use createMany for efficiency
    await db.videoScene.createMany({
      data: template.scenes.map((s) => ({
        projectId: project.id,
        sceneNumber: s.sceneNumber,
        title: s.title,
        prompt: s.prompt,
        enhancedPrompt: s.enhancedPrompt,
        visualNote: s.visualNote,
        dialogue: s.dialogue,
        mood: s.mood,
        cameraMove: s.cameraMove,
        musicMood: s.musicMood,
        duration: s.duration,
        transition: s.transition,
        imageUrl: s.imageUrl,
        videoUrl: s.videoUrl,
        status: "completed",
      })),
    });

    // Fetch the full project with scenes + characters to return
    const fullProject = await db.videoProject.findUnique({
      where: { id: project.id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json({
      success: true,
      isDemo: true,
      templateId: template.id,
      project: fullProject,
      message: `Demo project "${template.title}" created — explore the studio to see all ${template.scenes.length} scenes with playable videos.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[demo/create] Failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create demo project: " + message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/demo/create
 * Convenience: creates a demo project using the default template without
 * requiring a POST body. Useful for one-click demo links.
 */
export async function GET() {
  // Reuse POST logic with no body
  const req = new NextRequest("http://localhost/api/demo/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return POST(req);
}

/**
 * Templates list is served from /api/demo/templates — keep this file focused.
 */
export { DEMO_TEMPLATES };
