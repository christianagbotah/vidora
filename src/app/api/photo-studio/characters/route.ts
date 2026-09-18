import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";
import { normalizeAssetIds, sanitizePerformanceProfile } from "@/lib/photo-studio";

export const runtime = "nodejs";

function limited(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, max);
  return normalized || null;
}

export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const profiles = await db.characterProfile.findMany({
      where: { userId: auth.session.userId },
      include: { primaryAsset: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ success: true, profiles });
  } catch (error) {
    console.error("[photo-studio characters GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load Character Forge profiles" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const name = limited(body.name, 160);
    const primaryAssetId = limited(body.primaryAssetId, 200);

    if (!name || !primaryAssetId) {
      return NextResponse.json(
        { success: false, error: "Character name and a primary portrait are required" },
        { status: 400 },
      );
    }
    if (body.consentConfirmed !== true) {
      return NextResponse.json(
        { success: false, error: "Confirm that you own this image or have permission to animate this person" },
        { status: 400 },
      );
    }

    const requestedReferences = normalizeAssetIds(body.referenceAssetIds, 8);
    const assetIds = [...new Set([primaryAssetId, ...requestedReferences])];
    const assets = await db.mediaAsset.findMany({
      where: { userId: auth.session.userId, id: { in: assetIds }, kind: "image" },
      select: { id: true },
    });
    if (assets.length !== assetIds.length) {
      return NextResponse.json({ success: false, error: "One or more reference images are unavailable" }, { status: 404 });
    }

    const profile = await db.characterProfile.create({
      data: {
        userId: auth.session.userId,
        name,
        role: limited(body.role, 80),
        description: limited(body.description, 10_000),
        stylePrompt: limited(body.stylePrompt, 10_000),
        voiceId: limited(body.voiceId, 120),
        primaryAssetId,
        referenceAssetIds: JSON.stringify(assetIds),
        performanceProfile: JSON.stringify(sanitizePerformanceProfile(body.performanceProfile)),
        consentStatus: "confirmed",
        consentConfirmedAt: new Date(),
      },
      include: { primaryAsset: true },
    });

    return NextResponse.json({ success: true, profile }, { status: 201 });
  } catch (error) {
    console.error("[photo-studio characters POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create reusable character profile" }, { status: 500 });
  }
}
