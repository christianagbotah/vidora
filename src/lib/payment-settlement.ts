import { db } from "@/lib/db";
import { getGatewayByName, type VerificationResult } from "@/lib/payments";

interface PurchaseSnapshot {
  packageId?: string | null;
  packageSlug?: string | null;
  baseTokens: number;
  bonusTokens: number;
  amountMinor: number;
  currency: string;
  gateway: string;
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function snapshotFromPayment(payment: {
  gateway: string;
  amount: number;
  expectedAmountMinor: number;
  currency: string;
  tokensPurchased: number;
  bonusTokens: number;
  packageSlug: string | null;
  metadata: string | null;
}): PurchaseSnapshot {
  if (payment.expectedAmountMinor > 0) {
    return {
      packageSlug: payment.packageSlug,
      baseTokens: payment.tokensPurchased,
      bonusTokens: payment.bonusTokens,
      amountMinor: payment.expectedAmountMinor,
      currency: payment.currency.toUpperCase(),
      gateway: payment.gateway,
    };
  }

  const meta = parseMetadata(payment.metadata);
  const rawSnapshot = meta.purchaseSnapshot;
  if (rawSnapshot && typeof rawSnapshot === "object" && !Array.isArray(rawSnapshot)) {
    const s = rawSnapshot as Record<string, unknown>;
    const baseTokens = Number(s.baseTokens);
    const bonusTokens = Number(s.bonusTokens ?? 0);
    const amountMinor = Number(s.amountMinor);
    const currency = String(s.currency || payment.currency).toUpperCase();
    const gateway = String(s.gateway || payment.gateway);
    if (
      Number.isSafeInteger(baseTokens) && baseTokens > 0 &&
      Number.isSafeInteger(bonusTokens) && bonusTokens >= 0 &&
      Number.isSafeInteger(amountMinor) && amountMinor >= 0
    ) {
      return {
        packageId: typeof s.packageId === "string" ? s.packageId : null,
        packageSlug: typeof s.packageSlug === "string" ? s.packageSlug : null,
        baseTokens,
        bonusTokens,
        amountMinor,
        currency,
        gateway,
      };
    }
  }

  const legacyBonus = Number(meta.bonusTokens ?? 0);
  return {
    baseTokens: payment.tokensPurchased,
    bonusTokens: Number.isSafeInteger(legacyBonus) && legacyBonus > 0 ? legacyBonus : 0,
    amountMinor: Math.round(payment.amount * 100),
    currency: payment.currency.toUpperCase(),
    gateway: payment.gateway,
  };
}

export async function verifyAndSettleByReference(reference: string) {
  const payment = await db.payment.findFirst({ where: { gatewayRef: reference } });
  if (!payment) return { success: false as const, status: 404, error: "Payment not found" };

  const gateway = getGatewayByName(payment.gateway);
  const verification = await gateway.verifyPayment(reference);
  if (!verification.success || !verification.verified) {
    return { success: false as const, status: 422, error: verification.error || "Payment could not be verified" };
  }
  return settleVerifiedPayment(payment.id, verification);
}

export async function settleVerifiedPayment(paymentId: string, verification: VerificationResult) {
  const initial = await db.payment.findUnique({ where: { id: paymentId } });
  if (!initial) return { success: false as const, status: 404, error: "Payment not found" };

  const expected = snapshotFromPayment(initial);
  const amountMinor = verification.amountMinor ?? (
    typeof verification.amount === "number" ? Math.round(verification.amount * 100) : NaN
  );
  const verifiedCurrency = String(verification.currency || expected.currency).toUpperCase();

  if (!verification.verified || !Number.isSafeInteger(amountMinor)) {
    return { success: false as const, status: 422, error: "Provider did not return a verified payment amount" };
  }
  if (verification.reference && verification.reference !== initial.gatewayRef) {
    return { success: false as const, status: 422, error: "Provider reference mismatch" };
  }
  if (amountMinor !== expected.amountMinor) {
    return { success: false as const, status: 422, error: "Verified payment amount does not match the purchase" };
  }
  if (verifiedCurrency !== expected.currency) {
    return { success: false as const, status: 422, error: "Verified payment currency does not match the purchase" };
  }
  if (expected.gateway !== initial.gateway) {
    return { success: false as const, status: 422, error: "Payment gateway snapshot mismatch" };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const lockKey = `vidora-payment:${paymentId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const current = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!current) throw new Error("Payment not found");
      if (current.status === "refunded") throw new Error("Refunded payment cannot be settled");

      if (current.settledAt || current.status === "completed") {
        const user = await tx.user.findUnique({ where: { id: current.userId }, select: { tokens: true } });
        return { alreadySettled: true, totalCredited: 0, newBalance: user?.tokens ?? 0 };
      }

      const settledAt = new Date();
      const currentMeta = parseMetadata(current.metadata);
      const settledMeta = {
        ...currentMeta,
        settlement: {
          settledAt: settledAt.toISOString(),
          verifiedAmountMinor: amountMinor,
          verifiedCurrency,
          providerTransactionId: verification.providerTransactionId || null,
        },
      };

      const totalTokens = expected.baseTokens + expected.bonusTokens;
      const updated = await tx.user.update({
        where: { id: current.userId },
        data: { tokens: { increment: totalTokens } },
        select: { tokens: true },
      });

      await tx.tokenTransaction.create({
        data: {
          userId: current.userId,
          type: "purchase",
          amount: expected.baseTokens,
          description: `Purchased ${expected.baseTokens} tokens via ${current.gateway}`,
          referenceId: current.id,
          idempotencyKey: `payment:${current.id}:purchase`,
          operationType: "purchase",
        },
      });

      if (expected.bonusTokens > 0) {
        await tx.tokenTransaction.create({
          data: {
            userId: current.userId,
            type: "bonus",
            amount: expected.bonusTokens,
            description: `Purchase bonus: ${expected.bonusTokens} tokens`,
            referenceId: current.id,
            idempotencyKey: `payment:${current.id}:bonus`,
            operationType: "purchase",
          },
        });
      }

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: "completed",
          settledAt,
          providerTransactionId: verification.providerTransactionId || current.providerTransactionId,
          metadata: JSON.stringify(settledMeta),
        },
      });

      return { alreadySettled: false, totalCredited: totalTokens, newBalance: updated.tokens };
    });

    return { success: true as const, status: 200, ...result };
  } catch (error) {
    console.error("Payment settlement failed", {
      paymentId,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return { success: false as const, status: 500, error: "Payment settlement failed safely; it can be retried" };
  }
}
