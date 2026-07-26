import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * GET /api/social/connections
 * Returns the current user's social platform connections.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
    }
    const userId = (session.user as Record<string, unknown>).id as string;
    const connections = await db.socialConnection.findMany({ where: { userId } });
    return NextResponse.json({ success: true, connections });
  } catch (error) {
    console.error("[social connections GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load connections" }, { status: 500 });
  }
}

/**
 * POST /api/social/connections
 * Stub for OAuth connection flow. In production, this would redirect to the
 * platform's OAuth consent screen. For now, it marks a platform as connected
 * with placeholder data so the UI can be tested.
 * Body: { platform: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
    }
    const userId = (session.user as Record<string, unknown>).id as string;
    const { platform } = await req.json();

    const validPlatforms = ["youtube", "tiktok", "instagram", "facebook", "twitter"];
    if (!validPlatforms.includes(platform)) {
      return NextResponse.json({ success: false, error: "Invalid platform" }, { status: 400 });
    }

    // In production, this would redirect to OAuth:
    //   YouTube: https://accounts.google.com/o/oauth2/auth?...
    //   TikTok:  https://www.tiktok.com/auth/authorize?...
    //   Instagram: https://api.instagram.com/oauth/authorize?...
    // For now, create a mock connection so the UI works.
    const existing = await db.socialConnection.findUnique({
      where: { userId_platform: { userId, platform } },
    });

    if (existing) {
      const updated = await db.socialConnection.update({
        where: { id: existing.id },
        data: {
          isConnected: !existing.isConnected,
          accountName: existing.isConnected ? null : `${session.user.name || "User"}'s ${platform}`,
          accountId: existing.isConnected ? null : `mock_${platform}_${Date.now()}`,
        },
      });
      return NextResponse.json({ success: true, connection: updated });
    }

    const connection = await db.socialConnection.create({
      data: {
        userId,
        platform,
        isConnected: true,
        accountName: `${session.user.name || "User"}'s ${platform}`,
        accountId: `mock_${platform}_${Date.now()}`,
      },
    });

    return NextResponse.json({
      success: true,
      connection,
      note: "OAuth stub: In production, this would redirect to the platform's consent screen. Configure real OAuth credentials in .env to enable live publishing.",
    });
  } catch (error) {
    console.error("[social connections POST]", error);
    return NextResponse.json({ success: false, error: "Failed to connect platform" }, { status: 500 });
  }
}

/**
 * DELETE /api/social/connections?platform=xxx
 * Disconnects a social platform.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
    }
    const userId = (session.user as Record<string, unknown>).id as string;
    const platform = req.nextUrl.searchParams.get("platform");
    if (!platform) {
      return NextResponse.json({ success: false, error: "Platform required" }, { status: 400 });
    }

    await db.socialConnection.updateMany({
      where: { userId, platform },
      data: { isConnected: false, accessToken: null, refreshToken: null, accountId: null, accountName: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[social connections DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to disconnect" }, { status: 500 });
  }
}
