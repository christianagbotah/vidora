import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { getLongFormProductionForUser } from "@/lib/long-form-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const productionId = id?.trim();
  if (!productionId) {
    return NextResponse.json({ success: false, error: "Production id is required" }, { status: 400 });
  }

  try {
    const production = await getLongFormProductionForUser({
      productionId,
      userId: auth.session.userId,
    });
    if (!production) {
      return NextResponse.json({ success: false, error: "Long-form production not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, production });
  } catch (error) {
    console.error(
      `[long-form-production] read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { success: false, error: "Could not load the long-form production" },
      { status: 500 },
    );
  }
}
