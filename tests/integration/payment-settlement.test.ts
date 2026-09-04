import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { settleVerifiedPayment } from "@/lib/payment-settlement";

const createdUsers: string[] = [];

async function createPendingPayment() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await db.user.create({
    data: {
      email: `payment-test-${nonce}@example.invalid`,
      name: "Payment Settlement Test",
      tokens: 3,
    },
  });
  createdUsers.push(user.id);

  const reference = `TEST-${nonce}`;
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      gateway: "paystack",
      gatewayRef: reference,
      packageSlug: "test-package",
      amount: 10,
      expectedAmountMinor: 1000,
      currency: "GHS",
      tokensPurchased: 20,
      bonusTokens: 5,
      settlementKey: `payment:paystack:${reference}`,
      status: "pending",
      metadata: JSON.stringify({
        purchaseSnapshot: {
          packageSlug: "test-package",
          baseTokens: 20,
          bonusTokens: 5,
          amountMinor: 1000,
          currency: "GHS",
          gateway: "paystack",
        },
      }),
    },
  });

  return { user, payment, reference };
}

function verified(reference: string) {
  return {
    success: true,
    verified: true,
    amountMinor: 1000,
    amount: 10,
    currency: "GHS",
    reference,
    providerTransactionId: `provider-${reference}`,
  } as const;
}

afterAll(async () => {
  for (const id of createdUsers) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

describe("payment settlement", () => {
  test("concurrent verified callbacks credit exactly once", async () => {
    const { user, payment, reference } = await createPendingPayment();
    const verification = verified(reference);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => settleVerifiedPayment(payment.id, verification))
    );

    expect(results.every((result) => result.success)).toBe(true);
    expect(results.filter((result) => result.success && !result.alreadySettled)).toHaveLength(1);

    const currentUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(currentUser.tokens).toBe(28); // initial 3 + 20 base + 5 bonus

    const currentPayment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(currentPayment.status).toBe("completed");
    expect(currentPayment.settledAt).not.toBeNull();
    expect(currentPayment.providerTransactionId).toBe(`provider-${reference}`);

    const ledger = await db.tokenTransaction.findMany({ where: { referenceId: payment.id } });
    expect(ledger).toHaveLength(2);
    expect(ledger.reduce((sum, row) => sum + row.amount, 0)).toBe(25);
    expect(await db.tokenTransaction.count({ where: { idempotencyKey: `payment:${payment.id}:purchase` } })).toBe(1);
    expect(await db.tokenTransaction.count({ where: { idempotencyKey: `payment:${payment.id}:bonus` } })).toBe(1);
  });

  test("recovers a legacy completed row that was marked complete before credit", async () => {
    const { user, payment, reference } = await createPendingPayment();
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "completed", settledAt: null },
    });

    const result = await settleVerifiedPayment(payment.id, verified(reference));
    expect(result.success).toBe(true);
    expect(result.success && result.alreadySettled).toBe(false);
    expect(result.success && result.totalCredited).toBe(25);

    const currentUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(currentUser.tokens).toBe(28);
    const currentPayment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(currentPayment.settledAt).not.toBeNull();
    expect(await db.tokenTransaction.count({ where: { referenceId: payment.id } })).toBe(2);
  });

  test("normalizes a legacy completed row with an existing purchase ledger without double credit", async () => {
    const { user, payment, reference } = await createPendingPayment();
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { tokens: 28 } }),
      db.payment.update({ where: { id: payment.id }, data: { status: "completed", settledAt: null } }),
      db.tokenTransaction.create({
        data: {
          userId: user.id,
          type: "purchase",
          amount: 20,
          description: "Legacy purchase",
          referenceId: payment.id,
          idempotencyKey: `legacy-payment:${payment.id}:purchase`,
          operationType: "purchase",
        },
      }),
      db.tokenTransaction.create({
        data: {
          userId: user.id,
          type: "bonus",
          amount: 5,
          description: "Legacy bonus",
          referenceId: payment.id,
          idempotencyKey: `legacy-payment:${payment.id}:bonus`,
          operationType: "purchase",
        },
      }),
    ]);

    const result = await settleVerifiedPayment(payment.id, verified(reference));
    expect(result.success).toBe(true);
    expect(result.success && result.alreadySettled).toBe(true);
    expect(result.success && result.totalCredited).toBe(0);

    const currentUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(currentUser.tokens).toBe(28);
    const currentPayment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(currentPayment.settledAt).not.toBeNull();
  });

  test("amount mismatch fails closed without credit", async () => {
    const { user, payment, reference } = await createPendingPayment();
    const result = await settleVerifiedPayment(payment.id, {
      success: true,
      verified: true,
      amountMinor: 999,
      amount: 9.99,
      currency: "GHS",
      reference,
    });

    expect(result.success).toBe(false);
    const currentUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(currentUser.tokens).toBe(3);
    const currentPayment = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(currentPayment.status).toBe("pending");
    expect(await db.tokenTransaction.count({ where: { referenceId: payment.id } })).toBe(0);
  });

  test("currency mismatch fails closed without credit", async () => {
    const { user, payment, reference } = await createPendingPayment();
    const result = await settleVerifiedPayment(payment.id, {
      success: true,
      verified: true,
      amountMinor: 1000,
      amount: 10,
      currency: "USD",
      reference,
    });

    expect(result.success).toBe(false);
    const currentUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(currentUser.tokens).toBe(3);
  });
});
