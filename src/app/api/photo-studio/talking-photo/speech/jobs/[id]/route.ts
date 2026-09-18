import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/project-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const job = await db.talkingPhotoSpeechJob.findFirst({
    where: { id, userId: auth.session.userId },
  });
  if (!job) {
    return NextResponse.json({ success: false, error: "Digital Actor voice job not found" }, { status: 404 });
  }
  const outputAsset = job.outputAssetId
    ? await db.mediaAsset.findFirst({
        where: { id: job.outputAssetId, userId: auth.session.userId, kind: "audio" },
      })
    : null;
  return NextResponse.json({ success: true, job, outputAsset });
}
