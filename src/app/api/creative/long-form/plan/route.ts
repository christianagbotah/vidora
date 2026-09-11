import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { findReservationByReference } from "@/lib/credit-reservations";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import {
  LongFormPlanValidationError,
  buildLongFormPlannerPrompt,
  normalizeLongFormRequest,
  parseLongFormPlan,
} from "@/lib/long-form-planner";
import {
  reserveMeteredZaiTextOperation,
  resolveConfiguredBillableZaiTextModel,
} from "@/lib/zai-metered-billing";
import { submitBilledZaiText } from "@/lib/zai-billed-client";
import { captureActualMeteredLine, finalizeMeteredReservation } from "@/lib/metered-settlement";

export const runtime = "nodejs";

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_OUTPUT_TOKENS = 10_000;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return NextResponse.json(
      { success: false, error: "A valid JSON request body is required" },
      { status: 400 },
    );
  }

  let spec;
  try {
    spec = normalizeLongFormRequest({
      format: body.format,
      title: body.title,
      source: body.source,
      targetMinutes: body.targetMinutes,
      seasons: body.seasons,
      episodesPerSeason: body.episodesPerSeason,
      episodeMinutes: body.episodeMinutes,
    });
  } catch (error) {
    if (error instanceof LongFormPlanValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    throw error;
  }

  const supplied = req.headers.get("idempotency-key")?.trim();
  if (supplied && !IDEMPOTENCY_KEY_RE.test(supplied)) {
    return NextResponse.json(
      { success: false, error: "Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen" },
      { status: 400 },
    );
  }

  const requestKey = supplied || crypto.randomUUID();
  const referenceId = `long-form-plan:${authResult.session.userId}:${requestKey}`;

  if (supplied) {
    const prior = await findReservationByReference(referenceId);
    if (prior) {
      return NextResponse.json({
        success: false,
        error: "This long-form planning request was already funded/submitted. Use a new idempotency key to create another plan.",
        replayed: true,
      }, { status: 409 });
    }
  }

  const prompts = buildLongFormPlannerPrompt(spec);

  try {
    const model = await resolveConfiguredBillableZaiTextModel();
    const lineKeyPrefix = `${referenceId}:billing`;
    const billing = await reserveMeteredZaiTextOperation({
      userId: authResult.session.userId,
      referenceId,
      idempotencyKey: `${referenceId}:reservation`,
      lineKeyPrefix,
      label: `Long-form ${spec.format} story-bible and episode architecture`,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      model,
      requireConfiguredPrimary: true,
    });

    const result = await submitBilledZaiText({
      model: billing.model,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinking: "enabled",
      temperature: 0.35,
      timeoutMs: 180_000,
    });

    if (!result.usage) {
      throw new Error(
        "Z.ai returned no usage metadata; the prepaid long-form planning reserve is held for reconciliation",
      );
    }

    const inputCapture = await captureActualMeteredLine({
      reservationId: billing.reservation.id,
      lineKey: `${lineKeyPrefix}:input`,
      userId: authResult.session.userId,
      actualQuantity: result.usage.inputTokens,
    });
    const outputCapture = await captureActualMeteredLine({
      reservationId: billing.reservation.id,
      lineKey: `${lineKeyPrefix}:output`,
      userId: authResult.session.userId,
      actualQuantity: result.usage.outputTokens,
    });
    const finalized = await finalizeMeteredReservation({
      reservationId: billing.reservation.id,
      userId: authResult.session.userId,
      reason: "Long-form plan actual Z.ai token usage settled",
    });

    let plan;
    try {
      plan = parseLongFormPlan(result.content, spec);
    } catch (error) {
      if (error instanceof LongFormPlanValidationError) {
        console.error(`[long-form-plan] invalid provider plan: ${error.message}`);
        return NextResponse.json({
          success: false,
          error: "The AI long-form director returned an invalid production plan. No provider call will be repeated automatically; use a new idempotency key to try again.",
          code: "LONG_FORM_PLAN_INVALID",
          usage: result.usage,
          creditsCaptured: inputCapture.creditsCaptured + outputCapture.creditsCaptured,
          creditsReleased: finalized.creditsReleased,
        }, { status: 502 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      plan,
      planning: {
        model: billing.model,
        usage: result.usage,
        creditsCaptured: inputCapture.creditsCaptured + outputCapture.creditsCaptured,
        creditsReleased: finalized.creditsReleased,
        wallet: finalized.wallet,
        reservationId: billing.reservation.id,
        referenceId,
      },
    });
  } catch (error) {
    return providerBillingErrorResponse(error, {
      session: authResult.session,
      logLabel: "long-form-plan",
      fallbackStatus: 502,
      fallbackMessage: "The long-form story director could not complete this request. Please try again later.",
    });
  }
}
