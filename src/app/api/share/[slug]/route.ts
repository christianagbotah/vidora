import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

/**
 * GET /api/share/[slug]?password=xxx
 * Public (no auth) — returns project + scenes for the share page.
 * If the project has a password, the client must supply it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const project = await db.videoProject.findUnique({
      where: { shareSlug: slug },
      include: {
        scenes: { orderBy: { sceneNumber: "asc" }, select: {
          id: true, sceneNumber: true, title: true, prompt: true,
          enhancedPrompt: true, dialogue: true, mood: true, cameraMove: true,
          musicMood: true, imageUrl: true, videoUrl: true, duration: true,
          transition: true, subtitleSrt: true, narrationUrl: true,
        } },
      },
    });

    if (!project || !project.isPublic) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    // Password check
    if (project.sharePassword) {
      const provided = req.nextUrl.searchParams.get("password") || req.headers.get("x-share-password") || "";
      const valid = await bcrypt.compare(provided, project.sharePassword);
      if (!valid) {
        return NextResponse.json({ success: false, requiresPassword: true }, { status: 401 });
      }
    }

    // Analytics: record a view
    const viewerId = req.headers.get("x-viewer-id") || Math.random().toString(36).slice(2);
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
    const ua = req.headers.get("user-agent") || "";
    const referer = req.headers.get("referer") || "";

    await db.videoView.create({
      data: {
        projectId: project.id,
        viewerId,
        ipAddress: ip,
        userAgent: ua.slice(0, 500),
        referer: referer.slice(0, 500),
      },
    }).catch(() => { /* analytics failure is non-fatal */ });

    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        style: project.style,
        aspectRatio: project.aspectRatio,
        finalVideoUrl: project.finalVideoUrl,
        allowEmbed: project.allowEmbed,
      },
      scenes: project.scenes,
      viewerId,
    });
  } catch (error) {
    console.error("[share/[slug] GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load shared project" }, { status: 500 });
  }
}
