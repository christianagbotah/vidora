import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { findReservationByReference } from "@/lib/credit-reservations";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import { getLongFormEpisodeContextForUser } from "@/lib/long-form-store";
import {
  LongFormSequenceValidationError,
  buildEpisodeSequencePrompt,
  parseEpisodeSequencePlan,
} from "@/lib/long-form-sequence-planner";
import {
  LongFormExpansionBusyError,
  LongFormExpansionConflictError,
  claimLongFormEpisodeExpansion,
  releaseLongFormEpisodeExpansionClaim,
  replaceLongFormEpisodeSequences,
} from "@/lib/long-form-sequence-store";
import {
  reserveMeteredZaiTextOperation,
  resolveConfiguredBillableZaiTextModel,
} from "@/lib/zai-metered-billing";
import { submitBilledZaiText } from "@/lib/zai-billed-client";
import { captureActualMeteredLine, finalizeMeteredReservation } from "@/lib/metered-settlement";

export const runtime = "nodejs";

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function sequenceOutputBudget(sequenceCount: number): number {
  return Math.min(16_000, Math.max(6_000, 4_000 + sequenceCount * 550));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const episodeId = id?.trim();
  if (!episodeId) {
    return NextResponse.json({ success: false, error: "Episode id is required" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return NextResponse.json({ success: false, error: "A valid JSON request body is required" }, { status: 400 });
  }

  let context;
  try {
    context = await getLongFormEpisodeContextForUser({ episodeId, userId: auth.session.userId });
  } catch (error) {
    console.error(`[long-form-expand] context read failed: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ success: false, error: "Could not load the long-form episode" }, { status: 500 });
  }
  if (!context) {
    return NextResponse.json({ success: false, error: "Long-form episode not found" }, { status: 404 });
  }

  const expectedRaw = body.expectedExpansionVersion;
  const expectedExpansionVersion = expectedRaw === undefined
    ? context.episode.expansionVersion
    : Number(expectedRaw);
  if (!Number.isSafeInteger(expectedExpansionVersion) || expectedExpansionVersion < 0) {
    return NextResponse.json({ success: false, error: "expectedExpansionVersion must be a non-negative integer" }, { status: 400 });
  }
  if (expectedExpansionVersion !== context.episode.expansionVersion) {
    return NextResponse.json({
      success: false,
      code: "LONG_FORM_EXPANSION_VERSION_CONFLICT",
      error: `Episode expansion is now version ${context.episode.expansionVersion}; reload before expanding it again.`,
      currentExpansionVersion: context.episode.expansionVersion,
    }, { status: 409 });
  }

  const supplied = req.headers.get("idempotency-key")?.trim();
  if (supplied && !IDEMPOTENCY_KEY_RE.test(supplied)) {
    return NextResponse.json({
      success: false,
      error: "Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen",
    }, { status: 400 });
  }
  const requestKey = supplied || crypto.randomUUID();
  const referenceId = `long-form-expand:${auth.session.userId}:${episodeId}:v${expectedExpansionVersion}:${requestKey}`;

  if (supplied) {
    const prior = await findReservationByReference(referenceId);
    if (prior) {
      return NextResponse.json({
        success: false,
        error: "This episode expansion was already funded/submitted. Use a new idempotency key only if you intentionally want another expansion.",
        replayed: true,
      }, { status: 409 });
    }
  }

  // Serialize the expensive boundary itself, not only the eventual sequence
  // write. This blocks two different idempotency keys from both paying for an
  // expansion of the same episode/version before optimistic persistence runs.
  try {
    await claimLongFormEpisodeExpansion({
      episodeId,
      userId: auth.session.userId,
      expectedExpansionVersion,
      activeKey: referenceId,
    });
  } catch (error) {
    if (error instanceof LongFormExpansionConflictError || error instanceof LongFormExpansionBusyError) {
      return NextResponse.json({
        success: false,
        code: error.code,
        error: error.message,
      }, { status: 409 });
    }
    console.error(`[long-form-expand] lease acquisition failed: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ success: false, error: "Could not claim this episode for expansion" }, { status: 500 });
  }

  const releaseClaim = async () => {
    await releaseLongFormEpisodeExpansionClaim({
      episodeId,
      userId: auth.session.userId,
      activeKey: referenceId,
    }).catch((error) => {
      console.error(`[long-form-expand] could not release expansion lease: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const prompts = buildEpisodeSequencePrompt(context);
  const maxOutputTokens = sequenceOutputBudget(prompts.sequenceCount);
  let providerSubmissionStarted = false;

  try {
    const model = await resolveConfiguredBillableZaiTextModel();
    const lineKeyPrefix = `${referenceId}:billing`;
    const billing = await reserveMeteredZaiTextOperation({
      userId: auth.session.userId,
      referenceId,
      idempotencyKey: `${referenceId}:reservation`,
      lineKeyPrefix,
      label: `Long-form episode ${context.episode.episodeNumber} sequence direction`,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      maxOutputTokens,
      model,
      requireConfiguredPrimary: true,
    });

    // From this point onward a thrown transport error may mean the provider saw
    // the request. Keep the episode lease in that indeterminate case so a second
    // request cannot accidentally spend again before reconciliation.
    providerSubmissionStarted = true;
    const result = await submitBilledZaiText({
      model: billing.model,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      maxOutputTokens,
      thinking: "enabled",
      temperature: 0.3,
      timeoutMs: 180_000,
    });
    if (!result.usage) {
      throw new Error("Z.ai returned no usage metadata; the prepaid episode-expansion reserve and lease are held for reconciliation");
    }

    const inputCapture = await captureActualMeteredLine({
      reservationId: billing.reservation.id,
      lineKey: `${lineKeyPrefix}:input`,
      userId: auth.session.userId,
      actualQuantity: result.usage.inputTokens,
    });
    const outputCapture = await captureActualMeteredLine({
      reservationId: billing.reservation.id,
      lineKey: `${lineKeyPrefix}:output`,
      userId: auth.session.userId,
      actualQuantity: result.usage.outputTokens,
    });
    const finalized = await finalizeMeteredReservation({
      reservationId: billing.reservation.id,
      userId: auth.session.userId,
      reason: "Long-form episode sequence expansion actual token usage settled",
    });
    const settlement = {
      model: billing.model,
      maxOutputTokens,
      usage: result.usage,
      creditsCaptured: inputCapture.creditsCaptured + outputCapture.creditsCaptured,
      creditsReleased: finalized.creditsReleased,
      wallet: finalized.wallet,
      reservationId: billing.reservation.id,
      referenceId,
    };

    let sequences;
    try {
      sequences = parseEpisodeSequencePlan(result.content, context);
    } catch (error) {
      if (error instanceof LongFormSequenceValidationError) {
        console.error(`[long-form-expand] invalid provider sequence map: ${error.message}`);
        // Provider usage is known and settled, but there is no usable sequence
        // payload to recover. Release the lease so a deliberate new request can
        // be made later with a new idempotency key.
        await releaseClaim();
        return NextResponse.json({
          success: false,
          code: "LONG_FORM_SEQUENCE_PLAN_INVALID",
          error: "The AI episode director returned an invalid sequence map. The provider call was already settled and will not be repeated automatically.",
          planning: settlement,
        }, { status: 502 });
      }
      throw error;
    }

    try {
      const persistence = await replaceLongFormEpisodeSequences({
        episodeId,
        userId: auth.session.userId,
        expectedExpansionVersion,
        activeKey: referenceId,
        sequences,
      });
      return NextResponse.json({
        success: true,
        episodeId,
        sequences,
        persistence,
        planning: settlement,
      });
    } catch (error) {
      if (error instanceof LongFormExpansionConflictError || error instanceof LongFormExpansionBusyError) {
        await releaseClaim();
        return NextResponse.json({
          success: false,
          code: error.code,
          error: error.message,
          sequences,
          planning: settlement,
        }, { status: 409 });
      }
      console.error(`[long-form-expand] persistence failed after billed provider success: ${error instanceof Error ? error.message : String(error)}`);
      return NextResponse.json({
        success: false,
        code: "LONG_FORM_SEQUENCE_PERSISTENCE_FAILED",
        error: "The sequence map was generated and billed successfully but could not be saved. It is returned below and the episode expansion lease remains held for reconciliation; do not automatically rerun the AI expansion call.",
        sequences,
        expansionLeaseHeld: true,
        planning: settlement,
      }, { status: 503 });
    }
  } catch (error) {
    if (!providerSubmissionStarted) await releaseClaim();
    return providerBillingErrorResponse(error, {
      session: auth.session,
      logLabel: "long-form-expand",
      fallbackStatus: 502,
      fallbackMessage: "The episode director could not complete this expansion. Please try again later.",
    });
  }
}
