import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { rateLimit } from "@/lib/rate-limit";
import {
  createShareAccessToken,
  shareAccessCookieName,
} from "@/lib/share-access";

const shareUnlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const headers = new Headers(req.headers);
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || headers.get("x-real-ip") || "unknown";
    return `${ip}:${new URL(req.url).pathname}`;
  },
});

function anonymizeIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip") || "unknown";
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || ip === "unknown") return "unknown";
  return crypto
    .createHmac("sha256", secret)
    .update(ip, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Public share data endpoint. Password-protected shares accept the password
 * only through x-share-password so it never appears in URLs, proxy access
 * logs, browser history, analytics, or referrers.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const baseProject = await db.videoProject.findUnique({
      where: { shareSlug: slug },
      select: {
        id: true,
        title: true,
        description: true,
        style: true,
        aspectRatio: true,
        finalVideoUrl: true,
        allowEmbed: true,
        isPublic: true,
        sharePassword: true,
      },
    });

    if (!baseProject?.isPublic) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    let shareCapability: { token: string; maxAge: number } | null = null;
    if (baseProject.sharePassword) {
      const { limited } = shareUnlockLimiter(req);
      if (limited) {
        return NextResponse.json(
          {
            success: false,
            requiresPassword: true,
            error: "Too many unlock attempts. Please try again later.",
          },
          { status: 429, headers: { "Cache-Control": "no-store" } }
        );
      }

      const provided = req.headers.get("x-share-password") || "";
      if (!provided || provided.length > 256) {
        return NextResponse.json(
          { success: false, requiresPassword: true },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        );
      }

      const valid = await bcrypt.compare(provided, baseProject.sharePassword);
      if (!valid) {
        return NextResponse.json(
          { success: false, requiresPassword: true },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        );
      }
      shareCapability = createShareAccessToken(baseProject.id);
    }

    // Sensitive scene/media data is loaded only after the password boundary.
    const scenes = await db.videoScene.findMany({
      where: { projectId: baseProject.id },
      orderBy: { sceneNumber: "asc" },
      select: {
        id: true,
        sceneNumber: true,
        title: true,
        prompt: true,
        enhancedPrompt: true,
        dialogue: true,
        mood: true,
        cameraMove: true,
        musicMood: true,
        imageUrl: true,
        videoUrl: true,
        duration: true,
        transition: true,
        subtitleSrt: true,
        narrationUrl: true,
      },
    });

    const requestedViewer = (req.headers.get("x-viewer-id") || "").trim();
    const viewerId = /^[A-Za-z0-9_-]{8,128}$/.test(requestedViewer)
      ? requestedViewer
      : crypto.randomUUID();

    await db.videoView
      .create({
        data: {
          projectId: baseProject.id,
          viewerId,
          // Store a keyed pseudonymous value instead of a raw IP address.
          ipAddress: anonymizeIp(req),
          userAgent: (req.headers.get("user-agent") || "").slice(0, 500),
          referer: (req.headers.get("referer") || "").slice(0, 500),
        },
      })
      .catch(() => undefined);

    const response = NextResponse.json(
      {
        success: true,
        project: {
          id: baseProject.id,
          title: baseProject.title,
          description: baseProject.description?.replace(/^\[DEMO\]\s*/, "") || "",
          style: baseProject.style,
          aspectRatio: baseProject.aspectRatio,
          finalVideoUrl: baseProject.finalVideoUrl,
          allowEmbed: baseProject.allowEmbed,
          scenes,
        },
        viewerId,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );

    if (shareCapability) {
      response.cookies.set(
        shareAccessCookieName(baseProject.id),
        shareCapability.token,
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: shareCapability.maxAge,
        }
      );
    }

    return response;
  } catch (error) {
    console.error(
      "[share/[slug] GET]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to load shared project" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
