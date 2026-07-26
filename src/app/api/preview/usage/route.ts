import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPreviewUsage } from "@/lib/preview-limit";

/**
 * GET /api/preview/usage
 *
 * Returns the authenticated user's remaining free-preview quota for today.
 * Used by the UI to render "3/3 used today" badges on the preview buttons.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Please sign in." },
      { status: 401 }
    );
  }
  const userId = (session.user as Record<string, unknown>).id as string;

  const usage = await getPreviewUsage(userId);
  return NextResponse.json({ success: true, usage });
}
