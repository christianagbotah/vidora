import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";

const VALID_PLATFORMS = new Set([
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "twitter",
]);

/**
 * Return connection metadata only. OAuth access/refresh tokens are secrets and
 * must never be serialized to a browser response.
 */
export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const connections = await db.socialConnection.findMany({
      where: { userId: auth.session.userId },
      select: {
        id: true,
        platform: true,
        accountId: true,
        accountName: true,
        tokenExpiresAt: true,
        isConnected: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { platform: "asc" },
    });

    return NextResponse.json({ success: true, connections });
  } catch (error) {
    console.error(
      "[social connections GET]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to load connections" },
      { status: 500 }
    );
  }
}

/**
 * Social OAuth is intentionally fail-closed until a real provider-specific
 * OAuth callback/token exchange is implemented. Never create fake connected
 * accounts in a production API.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const platform = typeof body.platform === "string" ? body.platform : "";
    if (!VALID_PLATFORMS.has(platform)) {
      return NextResponse.json(
        { success: false, error: "Invalid platform" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: `${platform} account connection is not available yet. Real OAuth integration must be configured before this feature can be enabled.`,
        code: "SOCIAL_OAUTH_NOT_CONFIGURED",
      },
      { status: 501 }
    );
  } catch (error) {
    console.error(
      "[social connections POST]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to connect platform" },
      { status: 500 }
    );
  }
}

/** Disconnect a platform and erase any stored provider credentials. */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const platform = req.nextUrl.searchParams.get("platform") || "";
    if (!VALID_PLATFORMS.has(platform)) {
      return NextResponse.json(
        { success: false, error: "A valid platform is required" },
        { status: 400 }
      );
    }

    await db.socialConnection.updateMany({
      where: { userId: auth.session.userId, platform },
      data: {
        isConnected: false,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        accountId: null,
        accountName: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "[social connections DELETE]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to disconnect" },
      { status: 500 }
    );
  }
}
