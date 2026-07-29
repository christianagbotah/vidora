import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { generateImage } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * POST /api/generate-character-portrait
 *
 * Standalone character portrait generation — no project ID required.
 * Used on the Create page where detected characters haven't been
 * persisted to the database yet.
 *
 * Body: { name, description, role, style }
 * Returns: { success: true, base64: string }
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json();
    const { name, description, role, style } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: "Character name is required" },
        { status: 400 }
      );
    }

    // Build a vivid portrait prompt from character info
    const portraitPrompt = [
      description || `A character named ${name}`,
      role === "protagonist"
        ? "main character, central focus, heroic presence"
        : role === "narrator"
          ? "storyteller character, wise and observant"
          : role === "antagonist"
            ? "villain character, compelling antagonist"
            : "supporting character",
      style ? `${style} art style` : "cinematic digital art style",
      "professional character portrait, clean background",
      "high quality, detailed facial features, consistent design",
      "suitable for use as character reference in video generation",
    ].join(", ");

    const base64 = await generateImage({
      prompt: portraitPrompt,
      size: "1024x1024",
      retry: {
        label: `Pre-project character portrait: ${name}`,
        timeoutMs: 120_000,
        maxRetries: 3,
      },
    });

    return NextResponse.json({ success: true, base64 });
  } catch (error) {
    console.error("[character-portrait] Failed to generate portrait:", error);
    return zaiErrorResponse(error, {
      session: authResult.ok ? authResult.session : null,
      logLabel: "character-portrait-standalone",
    });
  }

}
