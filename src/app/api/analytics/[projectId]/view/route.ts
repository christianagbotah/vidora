import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  shareAccessCookieName,
  verifyShareAccessToken,
} from "@/lib/share-access";

const analyticsViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 180,
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
 * Record public share watch progress. Private projects are never writable
 * through this unauthenticated endpoint; password-protected shares require the
 * short-lived signed capability created by the share unlock endpoint.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const { limited } = analyticsViewLimiter(req);
    if (limited) {
      return NextResponse.json(
        { success: false, error: "Too many analytics updates" },
        { status: 429 }
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true, isPublic: true, sharePassword: true },
    });
    if (!project?.isPublic) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    if (project.sharePassword) {
      const token = req.cookies.get(shareAccessCookieName(project.id))?.value;
      if (!verifyShareAccessToken(token, project.id)) {
        return NextResponse.json(
          { success: false, error: "Share access required" },
          { status: 401 }
        );
      }
    }

    const body = await req.json().catch(() => ({}));
    const viewerId = typeof body.viewerId === "string" ? body.viewerId.trim() : "";
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(viewerId)) {
      return NextResponse.json(
        { success: false, error: "Valid viewerId required" },
        { status: 400 }
      );
    }

    const requestedWatch = Number(body.watchDuration ?? 0);
    if (!Number.isFinite(requestedWatch) || requestedWatch < 0) {
      return NextResponse.json(
        { success: false, error: "watchDuration must be a non-negative number" },
        { status: 400 }
      );
    }
    const watchDuration = Math.min(60, Math.floor(requestedWatch));
    const isComplete = body.isComplete === true;

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recent = await db.videoView.findFirst({
      where: {
        projectId,
        viewerId,
        createdAt: { gt: thirtyMinAgo },
      },
      orderBy: { createdAt: "desc" },
    });

    if (recent) {
      await db.videoView.update({
        where: { id: recent.id },
        data: {
          watchDuration: Math.min(
            24 * 60 * 60,
            (recent.watchDuration || 0) + watchDuration
          ),
          isComplete: isComplete || recent.isComplete,
        },
      });
    } else {
      await db.videoView.create({
        data: {
          projectId,
          viewerId,
          ipAddress: anonymizeIp(req),
          userAgent: (req.headers.get("user-agent") || "").slice(0, 500),
          referer: (req.headers.get("referer") || "").slice(0, 500),
          watchDuration,
          isComplete,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "[analytics view POST]",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to record view" },
      { status: 500 }
    );
  }
}
