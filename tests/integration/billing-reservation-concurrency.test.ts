import { afterAll, describe, expect, test } from "bun:test";
import crypto from "crypto";
import { db } from "@/lib/db";
import { createBillingQuote, reserveBillingQuote, type BillingQuoteLine } from "@/lib/credit-reservations";
import type { CommercialPricingPolicy } from "@/lib/provider-cost-billing";

const userId = `billing-ci-${crypto.randomUUID()}`;
const policy: CommercialPricingPolicy = {
  creditValueUsd: 0.01,
  targetGrossMarginPct: 0.35,
  providerSafetyBufferPct: 0.05,
  fxSafetyBufferPct: 0.05,
  gatewayFeeReservePct: 0.03,
  infrastructureReservePct: 0.03,
  minimumChargeCredits: 1,
  priceMaxAgeHours: 1080,
  quoteTtlMinutes: 15,
  billingEnabled: true,
};

function line(key: string): BillingQuoteLine {
  return {
    lineKey: key,
    label: `Concurrent test ${key}`,
    provider: "zai",
    model: "CogVideoX-3",
    operation: "video_generation",
    billingUnit: "request",
    quantity: 1,
    pricingVersion: "ci-test",
    sourceUrl: "https://example.invalid/price",
    verifiedAt: new Date().toISOString(),
    providerCostUsd: 0.2,
    providerSafetyUsd: 0.01,
    fxReserveUsd: 0.01,
    infrastructureReserveUsd: 0.006,
    gatewayFeeReserveUsd: 0.012,
    bufferedCostUsd: 0.238,
    customerPriceUsd: 0.4,
    credits: 40,
    customerValueUsd: 0.4,
    estimatedGrossProfitUsd: 0.162,
    estimatedGrossMarginPct: 0.405,
  };
}

afterAll(async () => {
  await db.$executeRaw`DELETE FROM "ProviderUsageLedger" WHERE "userId" = ${userId}`.catch(() => undefined);
  await db.$executeRaw`DELETE FROM "CreditReservation" WHERE "userId" = ${userId}`.catch(() => undefined);
  await db.$executeRaw`DELETE FROM "BillingQuote" WHERE "userId" = ${userId}`.catch(() => undefined);
  await db.tokenTransaction.deleteMany({ where: { userId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  await db.$disconnect();
});

describe("credit reservation concurrency", () => {
  test("two simultaneous 40-credit reservations cannot spend a 50-credit wallet twice", async () => {
    await db.user.create({
      data: {
        id: userId,
        email: `${userId}@vidora.local`,
        tokens: 50,
      },
    });
    const [quoteA, quoteB] = await Promise.all([
      createBillingQuote({ userId, operation: "project_generation", lines: [line("a")], policy }),
      createBillingQuote({ userId, operation: "project_generation", lines: [line("b")], policy }),
    ]);

    const results = await Promise.allSettled([
      reserveBillingQuote({ quoteId: quoteA.id, userId, referenceId: "run-a", idempotencyKey: `${userId}:a` }),
      reserveBillingQuote({ quoteId: quoteB.id, userId, referenceId: "run-b", idempotencyKey: `${userId}:b` }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
    expect(results.filter((result) => result.status === "rejected").length).toBe(1);

    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokens: true } });
    expect(user.tokens).toBe(10);
    const rows = await db.$queryRaw<Array<{ reserved: bigint | number }>>`
      SELECT COALESCE(SUM("reservedCredits"), 0) AS reserved
      FROM "CreditReservation" WHERE "userId" = ${userId}
    `;
    expect(Number(rows[0]?.reserved ?? 0)).toBe(40);
  });

  test("simultaneous duplicate requests converge on one reservation and one wallet debit", async () => {
    await db.user.update({ where: { id: userId }, data: { tokens: { increment: 50 } } });
    const quote = await createBillingQuote({
      userId,
      operation: "project_generation",
      lines: [line("same-request")],
      policy,
    });
    const idempotencyKey = `${userId}:same-request`;

    const [first, second] = await Promise.all([
      reserveBillingQuote({ quoteId: quote.id, userId, referenceId: "same-run", idempotencyKey }),
      reserveBillingQuote({ quoteId: quote.id, userId, referenceId: "same-run", idempotencyKey }),
    ]);

    expect(first.reservation.id).toBe(second.reservation.id);
    expect([first.alreadyReserved, second.alreadyReserved].filter(Boolean).length).toBe(1);

    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokens: true } });
    expect(user.tokens).toBe(20);
    const rows = await db.$queryRaw<Array<{ count: bigint | number; reserved: bigint | number }>>`
      SELECT COUNT(*) AS count, COALESCE(SUM("reservedCredits"), 0) AS reserved
      FROM "CreditReservation" WHERE "idempotencyKey" = ${idempotencyKey}
    `;
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
    expect(Number(rows[0]?.reserved ?? 0)).toBe(40);
  });
});
