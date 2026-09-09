import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { generateImage } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { portraitImageSizeForAspect } from "@/lib/image-prompt";
import { resolveZaiImageBillingModel } from "@/lib/zai-billing-models";
import {
  captureImmediateProviderOperation,
  reserveImmediateProviderOperation,
} from "@/lib/immediate-provider-billing";
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
      return NextResponse.json({ success: false, error: "Character name is required" }, { status: 400 });
    }
    if (name.length > 120 || description.length > 4_000) {
      return NextResponse.json({ success: false, error: "Character input is too long" }, { status: 413 });
    }

    const taskId = crypto.randomUUID();
    const prompt = buildPortraitPrompt(name, description, role, style);
    const billing = await reserveImmediateProviderOperation({
      userId: authResult.session.userId,
      referenceId: taskId,
      provider: "zai",
      model: resolveZaiImageBillingModel(),
      operation: "image_generation",
      quantity: 1,
      lineKey: `portrait:${taskId}`,
      label: `Character portrait: ${name}`,
      idempotencyKey: `portrait:${taskId}:reservation`,
    });
    const capture = await captureImmediateProviderOperation({
      reservationId: billing.reservation.id,
      lineKey: billing.line.lineKey,
      userId: authResult.session.userId,
    });

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
        console.error(
          `[character-portrait] Task ${taskId} failed after prepaid provider boundary:`,
          error instanceof Error ? error.message : "unknown error",
        );
      }
    })();

    return NextResponse.json({
      success: true,
      taskId,
      tokensCharged: capture.alreadyCaptured ? 0 : capture.creditsCaptured,
      remainingTokens: billing.wallet.availableCredits,
    });
  } catch (error) {
    console.error(
      "[character-portrait] Failed to start generation:",
      error instanceof Error ? error.message : "unknown error",
    );
    return zaiErrorResponse(error, {
      session: authResult.session,
      logLabel: "character-portrait-standalone",
    });
  }
}
