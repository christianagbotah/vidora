import crypto from "crypto";
import { db } from "@/lib/db";
import type { CommercialPricingPolicy, ProviderChargeQuote } from "@/lib/provider-cost-billing";

export interface BillingQuoteLine extends ProviderChargeQuote {
  lineKey: string;
  label: string;
  sceneId?: string | null;
}

export interface PersistedBillingQuote {
  id: string;
  userId: string;
  projectId: string | null;
  operation: string;
  status: string;
  pricingVersion: string;
  providerCostUsd: number;
  bufferedCostUsd: number;
  customerPriceUsd: number;
  creditsRequired: number;
  breakdown: BillingQuoteLine[];
  policySnapshot: CommercialPricingPolicy;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreditReservationSnapshot {
  id: string;
  userId: string;
  quoteId: string;
  referenceId: string | null;
  operation: string;
  reservedCredits: number;
  capturedCredits: number;
  releasedCredits: number;
  status: string;
}

export interface WalletSummary {
  availableCredits: number;
  reservedCredits: number;
  lifetimePurchasedCredits: number;
}

interface QuoteRow {
  id: string;
  userId: string;
  projectId: string | null;
  operation: string;
  status: string;
  pricingVersion: string;
  providerCostUsd: number;
  bufferedCostUsd: number;
  customerPriceUsd: number;
  creditsRequired: number;
  breakdown: string;
  policySnapshot: string;
  expiresAt: Date;
  createdAt: Date;
}

interface ReservationRow {
  id: string;
  userId: string;
  quoteId: string;
  referenceId: string | null;
  operation: string;
  reservedCredits: number;
  capturedCredits: number;
  releasedCredits: number;
  status: string;
}

function parseQuote(row: QuoteRow): PersistedBillingQuote {
  let breakdown: BillingQuoteLine[] = [];
  let policySnapshot = {} as CommercialPricingPolicy;
  try {
    const parsed = JSON.parse(row.breakdown) as unknown;
    if (Array.isArray(parsed)) breakdown = parsed as BillingQuoteLine[];
  } catch {
    throw new Error("Billing quote breakdown is corrupted");
  }
  try {
    policySnapshot = JSON.parse(row.policySnapshot) as CommercialPricingPolicy;
  } catch {
    throw new Error("Billing quote policy snapshot is corrupted");
  }
  return { ...row, breakdown, policySnapshot };
}

function operationType(line: BillingQuoteLine): string {
  if (line.operation === "video_generation") return "video_gen";
  if (line.operation === "image_generation") return "image_gen";
  return "tts";
}

function validateQuoteLines(lines: BillingQuoteLine[]): void {
  if (lines.length === 0) throw new Error("Cannot create an empty billing quote");
  const keys = new Set<string>();
  for (const line of lines) {
    if (!line.lineKey?.trim()) throw new Error("Billing quote line key is required");
    if (keys.has(line.lineKey)) throw new Error(`Duplicate billing quote line key: ${line.lineKey}`);
    keys.add(line.lineKey);
    if (!Number.isSafeInteger(line.credits) || line.credits <= 0) {
      throw new Error(`Billing quote line ${line.lineKey} has invalid credits`);
    }
    for (const [label, value] of [
      ["provider cost", line.providerCostUsd],
      ["buffered cost", line.bufferedCostUsd],
      ["customer value", line.customerValueUsd],
      ["quantity", line.quantity],
    ] as const) {
      if (!Number.isFinite(value) || value < 0 || (label === "quantity" && value <= 0)) {
        throw new Error(`Billing quote line ${line.lineKey} has invalid ${label}`);
      }
    }
    if (line.customerValueUsd + 1e-12 < line.bufferedCostUsd) {
      throw new Error(`Billing quote line ${line.lineKey} would sell below buffered cost`);
    }
  }
}

export async function createBillingQuote(opts: {
  userId: string;
  projectId?: string | null;
  operation: string;
  lines: BillingQuoteLine[];
  policy: CommercialPricingPolicy;
}): Promise<PersistedBillingQuote> {
  validateQuoteLines(opts.lines);
  const id = crypto.randomUUID();
  const providerCostUsd = opts.lines.reduce((sum, line) => sum + line.providerCostUsd, 0);
  const bufferedCostUsd = opts.lines.reduce((sum, line) => sum + line.bufferedCostUsd, 0);
  const customerPriceUsd = opts.lines.reduce((sum, line) => sum + line.customerValueUsd, 0);
  const creditsRequired = opts.lines.reduce((sum, line) => sum + line.credits, 0);
  if (!Number.isSafeInteger(creditsRequired) || creditsRequired <= 0) throw new Error("Invalid quote credits");
  const pricingVersion = [...new Set(opts.lines.map((line) => line.pricingVersion))].sort().join("+");
  const expiresAt = new Date(Date.now() + opts.policy.quoteTtlMinutes * 60_000);
  const breakdown = JSON.stringify(opts.lines);
  const policySnapshot = JSON.stringify(opts.policy);

  await db.$executeRaw`
    INSERT INTO "BillingQuote" (
      "id", "userId", "projectId", "operation", "status", "pricingVersion",
      "providerCostUsd", "bufferedCostUsd", "customerPriceUsd", "creditsRequired",
      "breakdown", "policySnapshot", "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${opts.userId}, ${opts.projectId ?? null}, ${opts.operation}, 'open', ${pricingVersion},
      ${providerCostUsd}, ${bufferedCostUsd}, ${customerPriceUsd}, ${creditsRequired},
      ${breakdown}, ${policySnapshot}, ${expiresAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  return {
    id,
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    operation: opts.operation,
    status: "open",
    pricingVersion,
    providerCostUsd,
    bufferedCostUsd,
    customerPriceUsd,
    creditsRequired,
    breakdown: opts.lines,
    policySnapshot: opts.policy,
    expiresAt,
    createdAt: new Date(),
  };
}

export async function getBillingQuote(quoteId: string): Promise<PersistedBillingQuote | null> {
  const rows = await db.$queryRaw<QuoteRow[]>`
    SELECT * FROM "BillingQuote" WHERE "id" = ${quoteId} LIMIT 1
  `;
  return rows[0] ? parseQuote(rows[0]) : null;
}

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  const [user, reservations, purchases] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { tokens: true } }),
    db.$queryRaw<Array<{ reserved: bigint | number }>>`
      SELECT COALESCE(SUM("reservedCredits" - "capturedCredits" - "releasedCredits"), 0) AS reserved
      FROM "CreditReservation"
      WHERE "userId" = ${userId} AND "status" IN ('reserved', 'partially_captured')
    `,
    db.tokenTransaction.aggregate({
      where: { userId, type: { in: ["purchase", "bonus"] } },
      _sum: { amount: true },
    }),
  ]);
  return {
    availableCredits: user?.tokens ?? 0,
    reservedCredits: Number(reservations[0]?.reserved ?? 0),
    lifetimePurchasedCredits: Number(purchases._sum.amount ?? 0),
  };
}

export async function reserveBillingQuote(opts: {
  quoteId: string;
  userId: string;
  referenceId?: string | null;
  idempotencyKey: string;
}): Promise<{ reservation: CreditReservationSnapshot; wallet: WalletSummary; alreadyReserved: boolean }> {
  const reservation = await db.$transaction(async (tx) => {
    // Fast replay path before acquiring the wallet row lock.
    const beforeLock = await tx.$queryRaw<ReservationRow[]>`
      SELECT * FROM "CreditReservation" WHERE "idempotencyKey" = ${opts.idempotencyKey} LIMIT 1
    `;
    if (beforeLock[0]) {
      if (beforeLock[0].userId !== opts.userId || beforeLock[0].quoteId !== opts.quoteId) {
        throw new Error("Billing reservation idempotency key belongs to another operation");
      }
      return { row: beforeLock[0], alreadyReserved: true };
    }

    // Every reservation for one wallet serializes here. Re-check idempotency
    // after the lock so two simultaneous copies of the same request converge
    // on one reservation instead of racing into a unique-index error.
    const lockedUsers = await tx.$queryRaw<Array<{ id: string; tokens: number }>>`
      SELECT "id", "tokens" FROM "User" WHERE "id" = ${opts.userId} FOR UPDATE
    `;
    if (lockedUsers.length !== 1) throw new Error("User not found");

    const afterLock = await tx.$queryRaw<ReservationRow[]>`
      SELECT * FROM "CreditReservation" WHERE "idempotencyKey" = ${opts.idempotencyKey} LIMIT 1
    `;
    if (afterLock[0]) {
      if (afterLock[0].userId !== opts.userId || afterLock[0].quoteId !== opts.quoteId) {
        throw new Error("Billing reservation idempotency key belongs to another operation");
      }
      return { row: afterLock[0], alreadyReserved: true };
    }

    const quoteRows = await tx.$queryRaw<QuoteRow[]>`
      SELECT * FROM "BillingQuote" WHERE "id" = ${opts.quoteId} FOR UPDATE
    `;
    const quoteRow = quoteRows[0];
    if (!quoteRow || quoteRow.userId !== opts.userId) throw new Error("Billing quote not found");
    if (quoteRow.status !== "open") throw new Error(`Billing quote is already ${quoteRow.status}`);
    if (new Date(quoteRow.expiresAt).getTime() <= Date.now()) {
      await tx.$executeRaw`UPDATE "BillingQuote" SET "status" = 'expired', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${opts.quoteId}`;
      throw new Error("Billing quote expired; request a fresh cost quote");
    }
    if (lockedUsers[0].tokens < quoteRow.creditsRequired) {
      throw new Error(`Insufficient credits. Need ${quoteRow.creditsRequired}, have ${lockedUsers[0].tokens}`);
    }

    const id = crypto.randomUUID();
    await tx.user.update({
      where: { id: opts.userId },
      data: { tokens: { decrement: quoteRow.creditsRequired } },
    });
    await tx.$executeRaw`
      INSERT INTO "CreditReservation" (
        "id", "userId", "quoteId", "referenceId", "operation", "reservedCredits",
        "capturedCredits", "releasedCredits", "status", "idempotencyKey", "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${opts.userId}, ${opts.quoteId}, ${opts.referenceId ?? null}, ${quoteRow.operation}, ${quoteRow.creditsRequired},
        0, 0, 'reserved', ${opts.idempotencyKey}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await tx.$executeRaw`
      UPDATE "BillingQuote" SET "status" = 'reserved', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${opts.quoteId}
    `;
    return {
      row: {
        id,
        userId: opts.userId,
        quoteId: opts.quoteId,
        referenceId: opts.referenceId ?? null,
        operation: quoteRow.operation,
        reservedCredits: quoteRow.creditsRequired,
        capturedCredits: 0,
        releasedCredits: 0,
        status: "reserved",
      },
      alreadyReserved: false,
    };
  });

  return {
    reservation: reservation.row,
    wallet: await getWalletSummary(opts.userId),
    alreadyReserved: reservation.alreadyReserved,
  };
}

export async function findReservationByReference(referenceId: string): Promise<CreditReservationSnapshot | null> {
  const rows = await db.$queryRaw<ReservationRow[]>`
    SELECT * FROM "CreditReservation"
    WHERE "referenceId" = ${referenceId}
      AND "status" IN ('reserved', 'partially_captured', 'captured')
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function captureReservedQuoteLine(opts: {
  reservationId: string;
  lineKey: string;
  userId: string;
  projectId?: string | null;
  sceneId?: string | null;
  generationRunId?: string | null;
  providerTaskId?: string | null;
}): Promise<{ creditsCaptured: number; alreadyCaptured: boolean }> {
  return db.$transaction(async (tx) => {
    const reservations = await tx.$queryRaw<ReservationRow[]>`
      SELECT * FROM "CreditReservation" WHERE "id" = ${opts.reservationId} FOR UPDATE
    `;
    const reservation = reservations[0];
    if (!reservation || reservation.userId !== opts.userId) throw new Error("Credit reservation not found");
    if (!['reserved', 'partially_captured'].includes(reservation.status)) {
      if (reservation.status === 'captured') {
        const existing = await tx.$queryRaw<Array<{ customerCredits: number }>>`
          SELECT "customerCredits" FROM "ProviderUsageLedger"
          WHERE "idempotencyKey" = ${`reservation:${opts.reservationId}:line:${opts.lineKey}`}
          LIMIT 1
        `;
        if (existing[0]) return { creditsCaptured: existing[0].customerCredits, alreadyCaptured: true };
      }
      throw new Error(`Credit reservation is ${reservation.status}`);
    }

    const usageKey = `reservation:${opts.reservationId}:line:${opts.lineKey}`;
    const existing = await tx.$queryRaw<Array<{ customerCredits: number }>>`
      SELECT "customerCredits" FROM "ProviderUsageLedger" WHERE "idempotencyKey" = ${usageKey} LIMIT 1
    `;
    if (existing[0]) return { creditsCaptured: existing[0].customerCredits, alreadyCaptured: true };

    const quoteRows = await tx.$queryRaw<QuoteRow[]>`
      SELECT * FROM "BillingQuote" WHERE "id" = ${reservation.quoteId} LIMIT 1
    `;
    if (!quoteRows[0]) throw new Error("Reservation quote not found");
    const quote = parseQuote(quoteRows[0]);
    const line = quote.breakdown.find((candidate) => candidate.lineKey === opts.lineKey);
    if (!line) throw new Error(`Billing quote does not contain line ${opts.lineKey}`);
    const remaining = reservation.reservedCredits - reservation.capturedCredits - reservation.releasedCredits;
    if (line.credits > remaining) throw new Error("Reservation does not have enough unconsumed credits for this provider call");

    const newCaptured = reservation.capturedCredits + line.credits;
    const settled = newCaptured + reservation.releasedCredits >= reservation.reservedCredits;
    await tx.$executeRaw`
      UPDATE "CreditReservation"
      SET "capturedCredits" = ${newCaptured},
          "status" = ${settled ? 'captured' : 'partially_captured'},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${reservation.id}
    `;

    const transaction = await tx.tokenTransaction.create({
      data: {
        userId: opts.userId,
        type: "spend",
        amount: -line.credits,
        description: `${line.label} (${line.provider}/${line.model})`,
        referenceId: opts.sceneId || opts.projectId || reservation.referenceId,
        idempotencyKey: `billing-usage:${usageKey}`,
        costUsd: line.providerCostUsd,
        operationType: operationType(line),
      },
    });

    const customerValueUsd = line.customerValueUsd;
    const grossProfitUsd = customerValueUsd - line.bufferedCostUsd;
    const grossMarginPct = customerValueUsd > 0 ? grossProfitUsd / customerValueUsd : 0;
    await tx.$executeRaw`
      INSERT INTO "ProviderUsageLedger" (
        "id", "userId", "projectId", "sceneId", "generationRunId", "reservationId",
        "provider", "model", "operation", "billingUnit", "quantity", "providerCostUsd",
        "customerCredits", "customerValueUsd", "grossProfitUsd", "grossMarginPct",
        "providerTaskId", "pricingVersion", "status", "idempotencyKey", "submittedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${crypto.randomUUID()}, ${opts.userId}, ${opts.projectId ?? null}, ${opts.sceneId ?? null}, ${opts.generationRunId ?? null}, ${reservation.id},
        ${line.provider}, ${line.model}, ${line.operation}, ${line.billingUnit}, ${line.quantity}, ${line.providerCostUsd},
        ${line.credits}, ${customerValueUsd}, ${grossProfitUsd}, ${grossMarginPct},
        ${opts.providerTaskId ?? null}, ${line.pricingVersion}, 'captured', ${usageKey}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;

    void transaction;
    if (settled) {
      await tx.$executeRaw`
        UPDATE "BillingQuote" SET "status" = 'consumed', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${reservation.quoteId}
      `;
    }
    return { creditsCaptured: line.credits, alreadyCaptured: false };
  });
}

export async function releaseReservationRemainder(opts: {
  reservationId: string;
  userId: string;
  reason: string;
}): Promise<{ creditsReleased: number; alreadyReleased: boolean }> {
  return db.$transaction(async (tx) => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "User" WHERE "id" = ${opts.userId} FOR UPDATE
    `;
    if (users.length !== 1) throw new Error("User not found");
    const rows = await tx.$queryRaw<ReservationRow[]>`
      SELECT * FROM "CreditReservation" WHERE "id" = ${opts.reservationId} FOR UPDATE
    `;
    const reservation = rows[0];
    if (!reservation || reservation.userId !== opts.userId) throw new Error("Credit reservation not found");
    const remaining = reservation.reservedCredits - reservation.capturedCredits - reservation.releasedCredits;
    if (remaining <= 0) return { creditsReleased: 0, alreadyReleased: true };

    await tx.user.update({ where: { id: opts.userId }, data: { tokens: { increment: remaining } } });
    const newReleased = reservation.releasedCredits + remaining;
    const finalStatus = reservation.capturedCredits > 0 ? "partially_captured" : "released";
    await tx.$executeRaw`
      UPDATE "CreditReservation"
      SET "releasedCredits" = ${newReleased}, "status" = ${finalStatus}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${reservation.id}
    `;
    await tx.$executeRaw`
      UPDATE "BillingQuote" SET "status" = ${reservation.capturedCredits > 0 ? 'partially_consumed' : 'released'}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${reservation.quoteId}
    `;
    await tx.tokenTransaction.create({
      data: {
        userId: opts.userId,
        type: "refund",
        amount: remaining,
        description: `Released unused reserved credits: ${opts.reason}`,
        referenceId: reservation.referenceId,
        idempotencyKey: `reservation:${reservation.id}:release:${newReleased}`,
        operationType: reservation.operation,
      },
    });
    return { creditsReleased: remaining, alreadyReleased: false };
  });
}
