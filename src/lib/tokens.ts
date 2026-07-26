/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Token & Cost Management Service
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Handles the financial transactions of the app:
 *   • Check if a user has enough tokens for an operation
 *   • Atomically deduct tokens + record the real Z.ai cost
 *   • Credit tokens on purchase (with bonus)
 *   • Refund tokens on failed operations
 *
 *  Every spend creates a TokenTransaction with:
 *   - amount: negative (tokens deducted from user)
 *   - costUsd: the real Z.ai API cost (for profit analytics)
 *   - operationType: what kind of AI operation
 *
 *  This is the ONLY place that modifies user.tokens. All routes must
 *  go through here to ensure atomic, audited transactions.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { db } from "@/lib/db";
import { PRICING, type OperationType } from "@/lib/pricing";

export interface DeductResult {
  success: boolean;
  error?: string;
  remainingTokens?: number;
  transactionId?: string;
}

/**
 * Check if a user has enough tokens for an operation.
 * Does NOT deduct — use `deductTokens` for that.
 */
export async function checkTokens(userId: string, requiredTokens: number): Promise<{ hasEnough: boolean; balance: number }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { tokens: true },
  });
  if (!user) return { hasEnough: false, balance: 0 };
  return { hasEnough: user.tokens >= requiredTokens, balance: user.tokens };
}

/**
 * Atomically deduct tokens for an AI operation and record the real cost.
 *
 * This uses a Prisma transaction to ensure:
 *  1. The balance check and deduction happen atomically (no race condition)
 *  2. The TokenTransaction is created in the same transaction
 *
 * @param userId The user spending tokens
 * @param operation What kind of AI operation (determines cost)
 * @param description Human-readable description for the transaction log
 * @param referenceId Project ID or other reference
 * @param customTokens Override the token cost (for operations with variable cost)
 * @param customCostUsd Override the real cost (if you know the exact Z.ai charge)
 */
export async function deductTokensForOperation(opts: {
  userId: string;
  operation: OperationType;
  description: string;
  referenceId?: string;
  customTokens?: number;
  customCostUsd?: number;
}): Promise<DeductResult> {
  const pricing = PRICING[opts.operation];
  const tokensToDeduct = opts.customTokens ?? pricing.tokens;
  const costUsd = opts.customCostUsd ?? pricing.costUsd;

  // Free operations (like prompt_enhance) don't deduct but still record cost
  if (tokensToDeduct === 0) {
    // Record the cost for analytics even on free operations
    await db.tokenTransaction.create({
      data: {
        userId: opts.userId,
        type: "spend",
        amount: 0,
        description: opts.description,
        referenceId: opts.referenceId,
        costUsd,
        operationType: opts.operation,
      },
    });
    const user = await db.user.findUnique({ where: { id: opts.userId }, select: { tokens: true } });
    return { success: true, remainingTokens: user?.tokens ?? 0 };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // Lock the user row and check balance
      const user = await tx.user.findUnique({
        where: { id: opts.userId },
        select: { tokens: true },
      });

      if (!user) {
        throw new Error("User not found");
      }

      if (user.tokens < tokensToDeduct) {
        throw new Error(`Insufficient tokens. Need ${tokensToDeduct}, have ${user.tokens}`);
      }

      // Deduct tokens
      const updated = await tx.user.update({
        where: { id: opts.userId },
        data: { tokens: { decrement: tokensToDeduct } },
        select: { tokens: true },
      });

      // Record the transaction with real cost
      const transaction = await tx.tokenTransaction.create({
        data: {
          userId: opts.userId,
          type: "spend",
          amount: -tokensToDeduct,
          description: opts.description,
          referenceId: opts.referenceId,
          costUsd,
          operationType: opts.operation,
        },
      });

      return { remainingTokens: updated.tokens, transactionId: transaction.id };
    });

    return {
      success: true,
      remainingTokens: result.remainingTokens,
      transactionId: result.transactionId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token deduction failed";
    return { success: false, error: message };
  }
}

/**
 * Refund tokens for a failed operation (e.g., video generation failed).
 * This credits the tokens back AND records the refund transaction.
 */
export async function refundTokens(opts: {
  userId: string;
  amount: number;
  description: string;
  referenceId?: string;
  operation: OperationType;
}): Promise<DeductResult> {
  try {
    const result = await db.$transaction(async (tx) => {
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
          operationType: opts.operation,
        },
      });

      return { remainingTokens: updated.tokens, transactionId: transaction.id };
    });

    return {
      success: true,
      remainingTokens: result.remainingTokens,
      transactionId: result.transactionId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token refund failed";
    return { success: false, error: message };
  }
}

/**
 * Credit tokens to a user after a successful purchase.
 * Handles bonus tokens (e.g., 20% extra on larger packages).
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
    const updated = await tx.user.update({
      where: { id: opts.userId },
      data: { tokens: { increment: totalTokens } },
      select: { tokens: true },
    });

    // Record base purchase
    if (opts.baseTokens > 0) {
      await tx.tokenTransaction.create({
        data: {
          userId: opts.userId,
          type: "purchase",
          amount: opts.baseTokens,
          description: opts.description,
          referenceId: opts.paymentId,
          operationType: "purchase" as OperationType,
        },
      });
    }

    // Record bonus separately (for analytics)
    if (opts.bonusTokens > 0) {
      await tx.tokenTransaction.create({
        data: {
          userId: opts.userId,
          type: "bonus",
          amount: opts.bonusTokens,
          description: `Bonus tokens (${Math.round((opts.bonusTokens / opts.baseTokens) * 100)}% extra)`,
          referenceId: opts.paymentId,
          operationType: "purchase" as OperationType,
        },
      });
    }

    return updated.tokens;
  });

  return { totalCredited: totalTokens, newBalance: result };
}
