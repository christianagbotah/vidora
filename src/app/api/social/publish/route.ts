import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";

const VALID_PLATFORMS = new Set([
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "twitter",
]);

/**
 * Publishing must fail closed until provider OAuth/upload integrations exist.
 * A production API must never report a fabricated external publication.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const platform = typeof body.platform === "string" ? body.platform : "";

    if (!projectId || !VALID_PLATFORMS.has(platform)) {
      return NextResponse.json(
        { success: false, error: "A valid projectId and platform are required" },
        { status: 400 }
      );
    }

    const access = await requireProjectAccess(projectId, true);
    if (!access.ok) return access.response;

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: { finalVideoUrl: true },
    });
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }
    if (!project.finalVideoUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "No final video to publish. Generate and export first.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: `${platform} publishing is not available yet. Real OAuth and provider upload integration must be configured before this feature can be enabled.`,
        code: "SOCIAL_PUBLISHING_NOT_CONFIGURED",
      },
      { status: 501 }
    );
  } catch (error) {
    console.error(
      "[social publish POST]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to publish" },
      { status: 500 }
    );
  }
}

/** Return publish history only to callers allowed to read the project. */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId") || "";
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "projectId required" },
        { status: 400 }
      );
    }

    const access = await requireProjectAccess(projectId, false);
    if (!access.ok) return access.response;

    const publishes = await db.socialPublish.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        projectId: true,
        platform: true,
        externalId: true,
        externalUrl: true,
        title: true,
        description: true,
        status: true,
        errorMessage: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, publishes });
  } catch (error) {
    console.error(
      "[social publish GET]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to load publishes" },
      { status: 500 }
    );
  }
}
