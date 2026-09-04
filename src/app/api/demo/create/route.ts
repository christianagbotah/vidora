import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_TEMPLATES, getDemoTemplate, getDemoFinalVideo } from "@/lib/demo-templates";
import { rateLimit } from "@/lib/rate-limit";

const demoCreateLimiter = rateLimit({ windowMs: 60_000, max: 5 });

export async function POST(req: NextRequest) {
  try {
    const { limited } = demoCreateLimiter(req);
    if (limited) {
      return NextResponse.json({ success: false, error: "Too many demo creations. Please try again shortly." }, { status: 429 });
    }

    let templateId: string | null = null;
    try {
      const body = await req.json();
      templateId = body?.templateId ?? null;
    } catch { /* optional body */ }

    const template = getDemoTemplate(templateId);
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      if (session?.user) userId = (session.user as Record<string, unknown>).id as string;
    } catch { /* anonymous demo */ }

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

    const fullProject = await db.videoProject.findUnique({
      where: { id: project.id },
      include: { scenes: { orderBy: { sceneNumber: "asc" } }, characters: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json({
      success: true,
      isDemo: true,
      readOnly: userId === null,
      templateId: template.id,
      project: fullProject,
      message: userId === null
        ? "Read-only demo created. Sign in to use AI-powered editing actions."
        : `Demo project "${template.title}" created.`,
    });
  } catch (error) {
    console.error("[demo/create] Failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to create demo project" }, { status: 500 });
  }
}

// GET is deliberately side-effect free. Resource creation must never happen on
// a cacheable/crawlable GET request.
export async function GET() {
  return NextResponse.json({
    success: true,
    templates: DEMO_TEMPLATES.map((template) => ({
      id: template.id,
      title: template.title,
      description: template.description,
      style: template.style,
      aspectRatio: template.aspectRatio,
      targetDuration: template.targetDuration,
      projectType: template.projectType,
      sceneCount: template.scenes.length,
    })),
  });
}

export { DEMO_TEMPLATES };
