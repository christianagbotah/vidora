import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { generateImage } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { taskStore } from "./task-store";

export const runtime = "nodejs";

/**
 * Build a vivid portrait prompt from character info.
 */
function buildPortraitPrompt(name: string, description: string, role?: string, style?: string): string {
  return [
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
}

/**
 * POST /api/generate-character-portrait
 *
 * Starts portrait generation in the background and returns a taskId
 * immediately. This avoids gateway timeouts on slow AI calls (30-120s).
 * Client should poll GET /api/generate-character-portrait/status?taskId=xxx
 * for the result.
 *
 * Body: { name, description, role, style }
 * Returns: { success: true, taskId: string }
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

    // Create a task and start generation in background
    const taskId = crypto.randomUUID();
    const prompt = buildPortraitPrompt(name, description, role, style);

    taskStore.set(taskId, { status: "generating", createdAt: Date.now() });

    // Fire-and-forget: generation runs in the background, avoids gateway timeout
    (async () => {
      try {
        const base64 = await generateImage({
          prompt,
          size: "1024x1024",
          retry: {
            label: `Pre-project character portrait: ${name}`,
            timeoutMs: 120_000,
            maxRetries: 2,
          },
        });
        const task = taskStore.get(taskId);
        if (task) {
          task.status = "complete";
          task.base64 = base64;
        }
      } catch (error) {
        const task = taskStore.get(taskId);
        if (task) {
          task.status = "failed";
          task.error = error instanceof Error ? error.message : "Unknown generation error";
        }
        console.error(`[character-portrait] Task ${taskId} failed for ${name}:`, error);
      }
    })();

    return NextResponse.json({ success: true, taskId });
  } catch (error) {
    console.error("[character-portrait] Failed to start generation:", error);
    return zaiErrorResponse(error, {
      session: authResult.ok ? authResult.session : null,
      logLabel: "character-portrait-standalone",
    });
  }
}
