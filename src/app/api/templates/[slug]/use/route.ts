import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/templates/[slug]/use
 * Creates a new project from a template, pre-filling scenes.
 * Body: { title? } — optional custom title
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as Record<string, unknown>).id as string : null;

    const { slug } = await params;
    const template = await db.projectTemplate.findUnique({ where: { slug } });
    if (!template || !template.isActive) {
      return NextResponse.json({ success: false, error: "Template not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const title = body.title || template.title;

    // Create the project
    const project = await db.videoProject.create({
      data: {
        userId,
        title,
        description: template.description,
        style: template.style,
        aspectRatio: template.aspectRatio,
        targetDuration: template.targetDuration,
        projectType: template.category,
        status: "draft",
      },
    });

    // Create scenes from template
    const scenes = JSON.parse(template.sceneTemplates) as Array<{
      title: string; prompt: string; mood: string; cameraMove: string;
      musicMood: string; duration: number; transition: string; dialogue?: string;
    }>;

    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      await db.videoScene.create({
        data: {
          projectId: project.id,
          sceneNumber: i + 1,
          title: s.title,
          prompt: s.prompt,
          dialogue: s.dialogue || null,
          mood: s.mood,
          cameraMove: s.cameraMove,
          musicMood: s.musicMood,
          duration: s.duration,
          transition: s.transition,
          status: "pending",
        },
      });
    }

    // Increment usage count
    await db.projectTemplate.update({
      where: { id: template.id },
      data: { usageCount: { increment: 1 } },
    });

    // Return full project with scenes
    const fullProject = await db.videoProject.findUnique({
      where: { id: project.id },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" } },
        characters: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json({
      success: true,
      project: fullProject,
      message: `Project created from "${template.title}" template with ${scenes.length} scenes.`,
    });
  } catch (error) {
    console.error("[template use POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create project from template" }, { status: 500 });
  }
}
