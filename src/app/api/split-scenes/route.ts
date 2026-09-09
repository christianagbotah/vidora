import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { findReservationByReference } from "@/lib/credit-reservations";
import { buildProfessionalSceneDirectorPrompt } from "@/lib/ai-provider-router";
import {
  reserveMeteredZaiTextOperation,
  resolveConfiguredBillableZaiTextModel,
} from "@/lib/zai-metered-billing";
import { submitBilledZaiText } from "@/lib/zai-billed-client";
import { captureActualMeteredLine, finalizeMeteredReservation } from "@/lib/metered-settlement";
import { POST as runSplitScenes } from "./legacy";

export const runtime = "nodejs";
const MAX_PROMPT_CHARS = 40_000;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function isLocallyStructuredScript(prompt: string): boolean {
  const explicitScenes = prompt.match(/(?:^|\n)\s*(?:🎬\s*)?Scene\s*\d+\s*[\-–—:]+/gim)?.length ?? 0;
  if (explicitScenes >= 2) return true;
  const numberedScenes = prompt.match(/(?:^|\n)\s*(?:🎬\s*)?\d+[.)]\s+/gm)?.length ?? 0;
  return numberedScenes >= 2;
}

function cleanStructuredOutput(value: string): string {
  return value.replace(/^```(?:text|markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return NextResponse.json({ success: false, error: "A valid JSON request body is required" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
  if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ success: false, error: `Prompt is too long (max ${MAX_PROMPT_CHARS} characters)` }, { status: 413 });

  const requestedDuration = Number(body.targetDuration ?? 60);
  if (!Number.isFinite(requestedDuration)) return NextResponse.json({ success: false, error: "targetDuration must be a number" }, { status: 400 });

  const structuredLocally = isLocallyStructuredScript(prompt);
  let providerDirectedPrompt = prompt;

  if (!structuredLocally) {
    const supplied = req.headers.get("idempotency-key")?.trim();
    const requestKey = supplied && IDEMPOTENCY_KEY_RE.test(supplied) ? supplied : crypto.randomUUID();
    const operationKey = `scene-split:${authResult.session.userId}:${requestKey}`;

    if (supplied) {
      const prior = await findReservationByReference(operationKey);
      if (prior) {
        return NextResponse.json({
          success: false,
          error: "This scene-planning request was already funded/submitted. Use a new idempotency key to run it again.",
          replayed: true,
        }, { status: 409 });
      }
    }

    const director = buildProfessionalSceneDirectorPrompt({
      source: prompt,
      targetDuration: Math.max(10, Math.min(300, Math.round(requestedDuration))),
      projectType: typeof body.projectType === "string" ? body.projectType : undefined,
    });

    try {
      const model = await resolveConfiguredBillableZaiTextModel();
      const lineKeyPrefix = `${operationKey}:billing`;
      const billing = await reserveMeteredZaiTextOperation({
        userId: authResult.session.userId,
        referenceId: operationKey,
        idempotencyKey: `${operationKey}:reservation`,
        lineKeyPrefix,
        label: "AI scene splitting, dialogue direction, and character detection",
        systemPrompt: director.systemPrompt,
        userPrompt: director.userPrompt,
        maxOutputTokens: 6_000,
        model,
        requireConfiguredPrimary: true,
      });
      const result = await submitBilledZaiText({
        model: billing.model,
        systemPrompt: director.systemPrompt,
        userPrompt: director.userPrompt,
        maxOutputTokens: 6_000,
        thinking: "enabled",
        temperature: 0.35,
        timeoutMs: 120_000,
      });
      if (!result.usage) throw new Error("Z.ai returned no usage metadata; the prepaid scene-planning reserve is held for reconciliation");
      await captureActualMeteredLine({
        reservationId: billing.reservation.id,
        lineKey: `${lineKeyPrefix}:input`,
        userId: authResult.session.userId,
        actualQuantity: result.usage.inputTokens,
      });
      await captureActualMeteredLine({
        reservationId: billing.reservation.id,
        lineKey: `${lineKeyPrefix}:output`,
        userId: authResult.session.userId,
        actualQuantity: result.usage.outputTokens,
      });
      await finalizeMeteredReservation({
        reservationId: billing.reservation.id,
        userId: authResult.session.userId,
        reason: "Scene planning actual Z.ai token usage settled",
      });
      providerDirectedPrompt = cleanStructuredOutput(result.content);
    } catch (error) {
      console.error("[split-scenes] funded provider-directed scene planning failed:", error);
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? `AI story director failed: ${error.message}` : "AI story director failed",
      }, { status: 502 });
    }

    if (!isLocallyStructuredScript(providerDirectedPrompt)) {
      console.error("[split-scenes] provider output was not in the required scene format");
      return NextResponse.json({ success: false, error: "The AI story director returned an invalid scene plan. Please try again." }, { status: 502 });
    }
  }

  const headers = new Headers(req.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const forwarded = new NextRequest(req.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, prompt: providerDirectedPrompt }),
  });
  return runSplitScenes(forwarded);
}
