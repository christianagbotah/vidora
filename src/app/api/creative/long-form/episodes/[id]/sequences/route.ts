import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { getLongFormEpisodeContextForUser } from "@/lib/long-form-store";
import { listLongFormEpisodeSequences } from "@/lib/long-form-sequence-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const episodeId = id?.trim();
  if (!episodeId) {
    return NextResponse.json({ success: false, error: "Episode id is required" }, { status: 400 });
  }

  try {
    const context = await getLongFormEpisodeContextForUser({
      episodeId,
      userId: auth.session.userId,
    });
    if (!context) {
      return NextResponse.json({ success: false, error: "Long-form episode not found" }, { status: 404 });
    }
    const sequences = await listLongFormEpisodeSequences({
      episodeId,
      userId: auth.session.userId,
    });
    return NextResponse.json({
      success: true,
      episode: context.episode,
      season: context.season,
      production: {
        id: context.productionId,
        title: context.productionTitle,
        format: context.format,
      },
      sequences,
    });
  } catch (error) {
    console.error(`[long-form-sequences] read failed: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { success: false, error: "Could not load the episode sequence map" },
      { status: 500 },
    );
  }
}
