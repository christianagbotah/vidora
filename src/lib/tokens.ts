import { db } from "@/lib/db";
import { PRICING, type OperationType } from "@/lib/pricing";

export interface DeductResult {
  success: boolean;
  error?: string;
  remainingTokens?: number;
  transactionId?: string;
  alreadyApplied?: boolean;
}

export async function checkTokens(userId: string, requiredTokens: number): Promise<{ hasEnough: boolean; balance: number }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { tokens: true } });
  if (!user) return { hasEnough: false, balance: 0 };
  return { hasEnough: user.tokens >= requiredTokens, balance: user.tokens };
}

/**
 * Serialize all balance mutations for one user on the real database row.
 *
 * Using SELECT ... FOR UPDATE avoids the Prisma deserialization problem that
 * pg_advisory_xact_lock() caused (it returns PostgreSQL void), and it keeps
 * the lock scoped to this transaction. The unique idempotencyKey constraint
 * remains a second, independent exactly-once guard.
 */
async function lockUser(tx: any, userId: string): Promise<void> {
  const rows = await tx.$queryRaw`
    SELECT "id"
    FROM "User"
    WHERE "id" = ${userId}
    FOR UPDATE
  ` as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw new Error("User not found");
  }
}

export async function deductTokensForOperation(opts: {
  userId: string;
  operation: OperationType;
  description: string;
  referenceId?: string;
  idempotencyKey?: string;
  customTokens?: number;
  customCostUsd?: number;
}): Promise<DeductResult> {
  const pricing = PRICING[opts.operation];
  const tokensToDeduct = opts.customTokens ?? pricing.tokens;
  const costUsd = opts.customCostUsd ?? pricing.costUsd;
  if (!Number.isSafeInteger(tokensToDeduct) || tokensToDeduct < 0) {
    return { success: false, error: "Invalid token charge" };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      await lockUser(tx, opts.userId);

      if (opts.idempotencyKey) {
        const existing = await tx.tokenTransaction.findUnique({
          where: { idempotencyKey: opts.idempotencyKey },
          select: { id: true, userId: true, amount: true },
        });
        if (existing) {
          if (existing.userId !== opts.userId || existing.amount !== -tokensToDeduct) {
            throw new Error("Idempotency key was already used for a different token operation");
          }
          const user = await tx.user.findUnique({ where: { id: opts.userId }, select: { tokens: true } });
          return { remainingTokens: user?.tokens ?? 0, transactionId: existing.id, alreadyApplied: true };
        }
      }

      if (tokensToDeduct === 0) {
        const transaction = await tx.tokenTransaction.create({
          data: {
            userId: opts.userId,
            type: "spend",
            amount: 0,
            description: opts.description,
            referenceId: opts.referenceId,
            idempotencyKey: opts.idempotencyKey,
            costUsd,
            operationType: opts.operation,
          },
        });
        const user = await tx.user.findUnique({ where: { id: opts.userId }, select: { tokens: true } });
        return { remainingTokens: user?.tokens ?? 0, transactionId: transaction.id, alreadyApplied: false };
      }

      const changed = await tx.user.updateMany({
        where: { id: opts.userId, tokens: { gte: tokensToDeduct } },
        data: { tokens: { decrement: tokensToDeduct } },
      });
      if (changed.count !== 1) {
        const user = await tx.user.findUnique({ where: { id: opts.userId }, select: { tokens: true } });
        throw new Error(`Insufficient tokens. Need ${tokensToDeduct}, have ${user?.tokens ?? 0}`);
      }

      const updated = await tx.user.findUnique({ where: { id: opts.userId }, select: { tokens: true } });
      const transaction = await tx.tokenTransaction.create({
        data: {
          userId: opts.userId,
          type: "spend",
          amount: -tokensToDeduct,
          description: opts.description,
          referenceId: opts.referenceId,
          idempotencyKey: opts.idempotencyKey,
          costUsd,
          operationType: opts.operation,
        },
      });
      return { remainingTokens: updated?.tokens ?? 0, transactionId: transaction.id, alreadyApplied: false };
    });

    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Token deduction failed" };
  }
}

export async function refundTokens(opts: {
  userId: string;
  amount: number;
  description: string;
  referenceId?: string;
  operation: OperationType;
  idempotencyKey?: string;
  relatedTransactionId?: string;
}): Promise<DeductResult> {
  if (!Number.isSafeInteger(opts.amount) || opts.amount <= 0) {
    return { success: false, error: "Invalid refund amount" };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      await lockUser(tx, opts.userId);

      if (opts.idempotencyKey) {
        const existing = await tx.tokenTransaction.findUnique({
          where: { idempotencyKey: opts.idempotencyKey },
          select: { id: true, userId: true, amount: true },
        });
        if (existing) {
          if (existing.userId !== opts.userId || existing.amount !== opts.amount) {
            throw new Error("Idempotency key was already used for a different refund");
          }
          const user = await tx.user.findUnique({ where: { id: opts.userId }, select: { tokens: true } });
          return { remainingTokens: user?.tokens ?? 0, transactionId: existing.id, alreadyApplied: true };
        }
      }

      const updated = await tx.user.update({
        where: { id: opts.userId },
        data: { tokens: { increment: opts.amount } },
        select: { tokens: true },
      });
      const transaction = await tx.tokenTransaction.create({
        data: {
          userId: opts.userId,
          type: "refund",
          amount: opts.amount,
          description: opts.description,
          referenceId: opts.referenceId,
          idempotencyKey: opts.idempotencyKey,
          relatedTransactionId: opts.relatedTransactionId,
          operationType: opts.operation,
        },
      });
      return { remainingTokens: updated.tokens, transactionId: transaction.id, alreadyApplied: false };
    });

    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Token refund failed" };
  }
}

/**
 * Legacy purchase helper retained for non-payment callers. Payment gateway
 * settlement uses payment-settlement.ts so completion + ledger + balance are
 * one exactly-once transaction.
 */
export async function creditPurchase(opts: {
  userId: string;
  baseTokens: number;
  bonusTokens: number;
  paymentId: string;
  description: string;
}): Promise<{ totalCredited: number; newBalance: number }> {
  const totalTokens = opts.baseTokens + opts.bonusTokens;
  const result = await db.$transaction(async (tx) => {
    await lockUser(tx, opts.userId);
    const baseKey = `legacy-payment:${opts.paymentId}:purchase`;
    const existing = await tx.tokenTransaction.findUnique({ where: { idempotencyKey: baseKey } });
    if (existing) {
      const user = await tx.user.findUnique({ where: { id: opts.userId }, select: { tokens: true } });
      return user?.tokens ?? 0;
    }

    const updated = await tx.user.update({
      where: { id: opts.userId },
      data: { tokens: { increment: totalTokens } },
      select: { tokens: true },
    });
    if (opts.baseTokens > 0) {
      await tx.tokenTransaction.create({
        data: {
          userId: opts.userId,
          type: "purchase",
          amount: opts.baseTokens,
          description: opts.description,
          referenceId: opts.paymentId,
          idempotencyKey: baseKey,
          operationType: "purchase",
        },
      });
    }
    if (opts.bonusTokens > 0) {
      await tx.tokenTransaction.create({
        data: {
          userId: opts.userId,
          type: "bonus",
          amount: opts.bonusTokens,
          description: `Bonus tokens: ${opts.bonusTokens}`,
          referenceId: opts.paymentId,
          idempotencyKey: `legacy-payment:${opts.paymentId}:bonus`,
          operationType: "purchase",
        },
      });
    }
    return updated.tokens;
  });
  return { totalCredited: totalTokens, newBalance: result };
}
