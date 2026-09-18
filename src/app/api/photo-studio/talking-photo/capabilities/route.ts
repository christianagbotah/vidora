import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { isFalTalkingPhotoConfigured } from "@/lib/fal-lipsync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    success: true,
    talkingPhoto: {
      available: await isFalTalkingPhotoConfigured(),
    },
  });
}
