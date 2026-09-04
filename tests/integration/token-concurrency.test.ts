import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { deductTokensForOperation, refundTokens } from "@/lib/tokens";

const createdUsers: string[] = [];

async function createUser(tokens: number) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await db.user.create({
    data: {
      email: `token-test-${nonce}@example.invalid`,
      name: "Token Concurrency Test",
      tokens,
    },
  });
  createdUsers.push(user.id);
  return user;
}

afterAll(async () => {
  for (const id of createdUsers) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

describe("token ledger concurrency", () => {
  test("concurrent spends never drive a balance negative", async () => {
    const user = await createUser(10);
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        deductTokensForOperation({
          userId: user.id,
          operation: "video_gen",
          description: `concurrency spend ${index}`,
          referenceId: "concurrency-test",
          idempotencyKey: `token-concurrency:${user.id}:${index}`,
          customTokens: 2,
          customCostUsd: 0,
        })
      )
    );

    expect(attempts.filter((result) => result.success).length).toBe(5);
    const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(current.tokens).toBe(0);

    const ledger = await db.tokenTransaction.findMany({ where: { userId: user.id, type: "spend" } });
    expect(ledger).toHaveLength(5);
    expect(ledger.reduce((sum, row) => sum + row.amount, 0)).toBe(-10);
  });

  test("one idempotency key applies a debit exactly once under concurrency", async () => {
    const user = await createUser(20);
    const key = `token-idempotent:${user.id}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        deductTokensForOperation({
          userId: user.id,
          operation: "video_gen",
          description: "same operation",
          referenceId: "same-operation",
          idempotencyKey: key,
          customTokens: 6,
          customCostUsd: 0,
        })
      )
    );

    expect(results.every((result) => result.success)).toBe(true);
    const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(current.tokens).toBe(14);
    expect(await db.tokenTransaction.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  test("one refund idempotency key credits exactly once", async () => {
    const user = await createUser(10);
    const charge = await deductTokensForOperation({
      userId: user.id,
      operation: "video_gen",
      description: "original charge",
      referenceId: "refund-test",
      idempotencyKey: `charge:${user.id}`,
      customTokens: 4,
      customCostUsd: 0,
    });
    expect(charge.success).toBe(true);

    const refundKey = `refund:${user.id}`;
    const refunds = await Promise.all(
      Array.from({ length: 6 }, () =>
        refundTokens({
          userId: user.id,
          amount: 4,
          description: "same refund",
          referenceId: "refund-test",
          operation: "video_gen",
          idempotencyKey: refundKey,
          relatedTransactionId: charge.transactionId,
        })
      )
    );

    expect(refunds.every((result) => result.success)).toBe(true);
    const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(current.tokens).toBe(10);
    expect(await db.tokenTransaction.count({ where: { idempotencyKey: refundKey } })).toBe(1);
  });
});
