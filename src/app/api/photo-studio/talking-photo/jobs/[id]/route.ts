import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const job = await db.talkingPhotoJob.findFirst({
    where: { id, userId: auth.session.userId },
    include: {
      imageAsset: {
        select: { id: true, originalName: true, url: true },
      },
      audioAsset: {
        select: { id: true, originalName: true, url: true, durationSeconds: true },
      },
    },
  });
  if (!job) {
    return NextResponse.json({ success: false, error: "Talking Photo job not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, job });
}
