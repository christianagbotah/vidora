import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { generateImage } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { deductTokensForOperation } from "@/lib/tokens";
import { portraitImageSizeForAspect } from "@/lib/image-prompt";
import { taskStore } from "./task-store";

export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const role = typeof body.role === "string" ? body.role : undefined;
    const style = typeof body.style === "string" ? body.style : undefined;
    const aspectRatio = typeof body.aspectRatio === "string" ? body.aspectRatio : undefined;

    if (!name) {
      return NextResponse.json(
        { success: false, error: "Character name is required" },
        { status: 400 }
      );
    }
    if (name.length > 120 || description.length > 4_000) {
      return NextResponse.json(
        { success: false, error: "Character input is too long" },
        { status: 413 }
      );
    }

    const taskId = crypto.randomUUID();
    const prompt = buildPortraitPrompt(name, description, role, style);
    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "image_gen",
      description: `Generate character portrait: ${name}`,
      referenceId: taskId,
      idempotencyKey: `portrait:${taskId}:image`,
    });
    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    taskStore.set(taskId, {
      userId: authResult.session.userId,
      status: "generating",
      createdAt: Date.now(),
    });

    void (async () => {
      try {
        const base64 = await generateImage({
          prompt,
          size: portraitImageSizeForAspect(aspectRatio),
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
          task.error = "Portrait generation failed";
        }
        // No automatic refund: provider failures/timeouts can be ambiguous.
        console.error(
          `[character-portrait] Task ${taskId} failed:`,
          error instanceof Error ? error.message : "unknown error"
        );
      }
    })();

    return NextResponse.json({
      success: true,
      taskId,
      tokensCharged: deduction.alreadyApplied ? 0 : 1,
      remainingTokens: deduction.remainingTokens,
    });
  } catch (error) {
    console.error(
      "[character-portrait] Failed to start generation:",
      error instanceof Error ? error.message : "unknown error"
    );
    return zaiErrorResponse(error, {
      session: authResult.session,
      logLabel: "character-portrait-standalone",
    });
  }
}
