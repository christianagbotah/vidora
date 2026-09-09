import crypto from "crypto";
import { db } from "@/lib/db";
import { calculateCommercialCharge } from "@/lib/provider-cost-billing";
import {
  getBillingQuote,
  getWalletSummary,
  releaseReservationRemainder,
} from "@/lib/credit-reservations";

interface ReservationRow {
  id: string;
  userId: string;
  quoteId: string;
  referenceId: string | null;
  reservedCredits: number;
  capturedCredits: number;
  releasedCredits: number;
  status: string;
}

interface UsageRow {
  customerCredits: number;
}

function operationType(operation: string): string {
  if (operation === "text_input" || operation === "text_output") return "llm";
  if (operation === "vision_input" || operation === "vision_output") return "vision";
  if (operation === "asr") return "asr";
  if (operation === "tts") return "tts";
  if (operation === "image_generation") return "image_gen";
  if (operation === "video_generation") return "video_gen";
  return operation;
}

/**
 * Capture one previously-reserved metered line at the provider's ACTUAL usage.
 * The reservation itself was sized conservatively before submission; this
 * function records only the commercial charge derived from actual usage.
 */
export async function captureActualMeteredLine(opts: {
  reservationId: string;
  lineKey: string;
  userId: string;
  actualQuantity: number;
  projectId?: string | null;
  sceneId?: string | null;
  generationRunId?: string | null;
  providerTaskId?: string | null;
}): Promise<{ creditsCaptured: number; alreadyCaptured: boolean }> {
  if (!Number.isFinite(opts.actualQuantity) || opts.actualQuantity <= 0) {
    throw new Error("Actual provider usage must be positive");
  }

  const reservationLookup = await db.$queryRaw<Array<{ quoteId: string; userId: string }>>`
    SELECT "quoteId", "userId" FROM "CreditReservation" WHERE "id" = ${opts.reservationId} LIMIT 1
  `;
  if (!reservationLookup[0] || reservationLookup[0].userId !== opts.userId) {
    throw new Error("Credit reservation not found");
  }
  const quote = await getBillingQuote(reservationLookup[0].quoteId);
  if (!quote) throw new Error("Reservation quote not found");
  const line = quote.breakdown.find((candidate) => candidate.lineKey === opts.lineKey);
  if (!line) throw new Error(`Billing quote does not contain line ${opts.lineKey}`);
  if (opts.actualQuantity > line.quantity + 1e-9) {
    throw new Error(
      `Actual ${line.operation} usage (${opts.actualQuantity}) exceeded the prepaid ceiling (${line.quantity}); hold for reconciliation`,
    );
  }

  const actualProviderCostUsd = line.providerCostUsd * (opts.actualQuantity / line.quantity);
  const actualCharge = calculateCommercialCharge(actualProviderCostUsd, quote.policySnapshot);
  if (actualCharge.credits > line.credits) {
    throw new Error("Actual commercial charge exceeded the prepaid quote line; hold for reconciliation");
  }

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ReservationRow[]>`
      SELECT * FROM "CreditReservation" WHERE "id" = ${opts.reservationId} FOR UPDATE
    `;
    const reservation = rows[0];
    if (!reservation || reservation.userId !== opts.userId) throw new Error("Credit reservation not found");

    const usageKey = `reservation:${opts.reservationId}:line:${opts.lineKey}`;
    const existing = await tx.$queryRaw<UsageRow[]>`
      SELECT "customerCredits" FROM "ProviderUsageLedger"
      WHERE "idempotencyKey" = ${usageKey}
      LIMIT 1
    `;
    if (existing[0]) {
      return { creditsCaptured: existing[0].customerCredits, alreadyCaptured: true };
    }
    if (!["reserved", "partially_captured"].includes(reservation.status)) {
      throw new Error(`Credit reservation is ${reservation.status}`);
    }

    const remaining = reservation.reservedCredits - reservation.capturedCredits - reservation.releasedCredits;
    if (actualCharge.credits > remaining) {
      throw new Error("Reservation does not have enough unconsumed credits for actual provider usage");
    }

    const newCaptured = reservation.capturedCredits + actualCharge.credits;
    const fullyAllocated = newCaptured + reservation.releasedCredits >= reservation.reservedCredits;
    await tx.$executeRaw`
      UPDATE "CreditReservation"
      SET "capturedCredits" = ${newCaptured},
          "status" = ${fullyAllocated ? "captured" : "partially_captured"},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${reservation.id}
    `;

    await tx.tokenTransaction.create({
      data: {
        userId: opts.userId,
        type: "spend",
        amount: -actualCharge.credits,
        description: `${line.label} — actual ${opts.actualQuantity} ${line.billingUnit}${opts.actualQuantity === 1 ? "" : "s"} (${line.provider}/${line.model})`,
        referenceId: opts.sceneId || opts.projectId || reservation.referenceId,
        idempotencyKey: `billing-usage:${usageKey}`,
        costUsd: actualProviderCostUsd,
        operationType: operationType(line.operation),
      },
    });

    await tx.$executeRaw`
      INSERT INTO "ProviderUsageLedger" (
        "id", "userId", "projectId", "sceneId", "generationRunId", "reservationId",
        "provider", "model", "operation", "billingUnit", "quantity", "providerCostUsd",
        "customerCredits", "customerValueUsd", "grossProfitUsd", "grossMarginPct",
        "providerTaskId", "pricingVersion", "status", "idempotencyKey",
        "submittedAt", "completedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${crypto.randomUUID()}, ${opts.userId}, ${opts.projectId ?? null}, ${opts.sceneId ?? null},
        ${opts.generationRunId ?? null}, ${reservation.id}, ${line.provider}, ${line.model},
        ${line.operation}, ${line.billingUnit}, ${opts.actualQuantity}, ${actualProviderCostUsd},
        ${actualCharge.credits}, ${actualCharge.customerValueUsd}, ${actualCharge.estimatedGrossProfitUsd},
        ${actualCharge.estimatedGrossMarginPct}, ${opts.providerTaskId ?? null}, ${line.pricingVersion},
        'settled_actual', ${usageKey}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;

    if (fullyAllocated) {
      await tx.$executeRaw`
        UPDATE "BillingQuote" SET "status" = 'consumed', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${reservation.quoteId}
      `;
    }
    return { creditsCaptured: actualCharge.credits, alreadyCaptured: false };
  });
}

/**
 * After all known actual-usage lines have been captured, refund the unused
 * ceiling. This is intentionally a separate durable transaction: if the
 * process dies first, funds remain held rather than being under-collected.
 */
export async function finalizeMeteredReservation(opts: {
  reservationId: string;
  userId: string;
  reason: string;
}) {
  const release = await releaseReservationRemainder(opts);
  return {
    ...release,
    wallet: await getWalletSummary(opts.userId),
  };
}
