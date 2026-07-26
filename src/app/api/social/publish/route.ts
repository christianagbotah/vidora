import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * POST /api/social/publish
 * Publishes a project's final video to a connected social platform.
 * Body: { projectId, platform, title?, description? }
 *
 * NOTE: In production, this would use the platform's API to upload the video.
 * (YouTube Data API, TikTok Content Posting API, Instagram Graph API, etc.)
 * For now, it creates a SocialPublish record with status "published" using the
 * mock connection, so the UI flow can be tested end-to-end.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
    }
    const userId = (session.user as Record<string, unknown>).id as string;
    const { projectId, platform, title, description } = await req.json();

    if (!projectId || !platform) {
      return NextResponse.json({ success: false, error: "projectId and platform required" }, { status: 400 });
    }

    // Verify the project exists and the user owns it
    const project = await db.videoProject.findUnique({ where: { id: projectId } });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
    if (project.userId && project.userId !== userId) {
      return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
    }
    if (!project.finalVideoUrl) {
      return NextResponse.json({ success: false, error: "No final video to publish. Generate and export first." }, { status: 400 });
    }

    // Check connection
    const connection = await db.socialConnection.findUnique({
      where: { userId_platform: { userId, platform } },
    });
    if (!connection || !connection.isConnected) {
      return NextResponse.json({ success: false, error: `Please connect your ${platform} account first.` }, { status: 400 });
    }

    // In production: upload video to the platform's API here.
    // For now, create a mock "published" record.
    const mockExternalId = `pub_${platform}_${Date.now()}`;
    const mockUrl = platform === "youtube" ? `https://youtube.com/watch?v=${mockExternalId}`
      : platform === "tiktok" ? `https://tiktok.com/@user/video/${mockExternalId}`
      : platform === "instagram" ? `https://instagram.com/p/${mockExternalId}`
      : platform === "facebook" ? `https://facebook.com/watch/?v=${mockExternalId}`
      : `https://${platform}.com/post/${mockExternalId}`;

    const publish = await db.socialPublish.create({
      data: {
        projectId,
        platform,
        externalId: mockExternalId,
        externalUrl: mockUrl,
        title: title || project.title,
        description: description || project.description?.replace(/^\[DEMO\]\s*/, "") || "",
        status: "published",
        publishedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      publish,
      message: `Published to ${platform}! View it at: ${mockUrl}`,
      note: "Mock publish: Configure real platform OAuth credentials and API integration in production.",
    });
  } catch (error) {
    console.error("[social publish POST]", error);
    return NextResponse.json({ success: false, error: "Failed to publish" }, { status: 500 });
  }
}

/**
 * GET /api/social/publish?projectId=xxx
 * Returns all social publish records for a project.
 */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ success: false, error: "projectId required" }, { status: 400 });
    }
    const publishes = await db.socialPublish.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, publishes });
  } catch (error) {
    console.error("[social publish GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load publishes" }, { status: 500 });
  }
}
