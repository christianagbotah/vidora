import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getCommercialPricingPolicy,
  listProviderPrices,
  normalizeBillingPolicy,
} from "@/lib/provider-cost-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as Record<string, unknown> | undefined)?.role;
  if (!session?.user) return { ok: false as const, response: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }) };
  if (role !== "admin") return { ok: false as const, response: NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 }) };
  return { ok: true as const };
}

async function readManualProviderReserveBalance(): Promise<number | null> {
  const row = await db.systemConfig.findUnique({ where: { key: "billing.provider_reserve_balance_usd" } });
  if (!row?.value) return null;
  const value = Number(row.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function billingSummary() {
  const policy = await getCommercialPricingPolicy();
  const [wallets, reservations, usage, payments, manualProviderReserveUsd] = await Promise.all([
    db.user.aggregate({ _sum: { tokens: true } }),
    db.$queryRaw<Array<{ credits: bigint | number }>>`
      SELECT COALESCE(SUM("reservedCredits" - "capturedCredits" - "releasedCredits"), 0) AS credits
      FROM "CreditReservation"
      WHERE "status" IN ('reserved', 'partially_captured')
    `,
    db.$queryRaw<Array<{ cogs: number; customer_value: number; profit: number; calls: bigint | number }>>`
      SELECT
        COALESCE(SUM("providerCostUsd"), 0)::float8 AS cogs,
        COALESCE(SUM("customerValueUsd"), 0)::float8 AS customer_value,
        COALESCE(SUM("grossProfitUsd"), 0)::float8 AS profit,
        COUNT(*) AS calls
      FROM "ProviderUsageLedger"
      WHERE "status" = 'captured'
    `,
    db.payment.findMany({
      where: { status: "completed" },
      select: { amount: true, currency: true },
    }),
    readManualProviderReserveBalance(),
  ]);

  const availableCredits = Number(wallets._sum.tokens ?? 0);
  const reservedCredits = Number(reservations[0]?.credits ?? 0);
  const outstandingCredits = availableCredits + reservedCredits;
  const outstandingFaceValueUsd = outstandingCredits * policy.creditValueUsd;
  // This is a conservative funding target for provider COGS, not an account
  // balance fetched from Z.ai/Qwen. It reflects the fraction of outstanding
  // customer value that is not allocated to gross margin or gateway reserve.
  const providerReserveRequiredUsd = Math.max(
    0,
    outstandingFaceValueUsd * (1 - policy.targetGrossMarginPct - policy.gatewayFeeReservePct),
  );
  const reserveCoveragePct = manualProviderReserveUsd === null || providerReserveRequiredUsd <= 0
    ? null
    : manualProviderReserveUsd / providerReserveRequiredUsd;

  const revenueGhs = payments.filter((p) => p.currency.toUpperCase() === "GHS").reduce((sum, p) => sum + p.amount, 0);
  const revenueUsd = payments.filter((p) => p.currency.toUpperCase() === "USD").reduce((sum, p) => sum + p.amount, 0);
  const used = usage[0] ?? { cogs: 0, customer_value: 0, profit: 0, calls: 0 };
  return {
    availableCredits,
    reservedCredits,
    outstandingCredits,
    outstandingFaceValueUsd,
    providerReserveRequiredUsd,
    manualProviderReserveUsd,
    reserveCoveragePct,
    reserveStatus: manualProviderReserveUsd === null
      ? "unknown"
      : reserveCoveragePct !== null && reserveCoveragePct >= 1
        ? "funded"
        : "underfunded",
    providerUsage: {
      calls: Number(used.calls ?? 0),
      cogsUsd: Number(used.cogs ?? 0),
      customerValueUsd: Number(used.customer_value ?? 0),
      grossProfitUsd: Number(used.profit ?? 0),
    },
    settledRevenue: { ghs: revenueGhs, usd: revenueUsd },
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const [policy, providerPrices, summary] = await Promise.all([
      getCommercialPricingPolicy(),
      listProviderPrices(),
      billingSummary(),
    ]);
    return NextResponse.json({
      success: true,
      policy,
      providerPrices: providerPrices.map((price) => ({
        ...price,
        verifiedAt: price.verifiedAt.toISOString(),
      })),
      summary,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Billing state unavailable" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json() as Record<string, unknown>;
    const current = await getCommercialPricingPolicy();
    const candidate = normalizeBillingPolicy({
      ...current,
      creditValueUsd: body.creditValueUsd === undefined ? current.creditValueUsd : Number(body.creditValueUsd),
      targetGrossMarginPct: body.targetGrossMarginPct === undefined ? current.targetGrossMarginPct : Number(body.targetGrossMarginPct),
      providerSafetyBufferPct: body.providerSafetyBufferPct === undefined ? current.providerSafetyBufferPct : Number(body.providerSafetyBufferPct),
      fxSafetyBufferPct: body.fxSafetyBufferPct === undefined ? current.fxSafetyBufferPct : Number(body.fxSafetyBufferPct),
      gatewayFeeReservePct: body.gatewayFeeReservePct === undefined ? current.gatewayFeeReservePct : Number(body.gatewayFeeReservePct),
      infrastructureReservePct: body.infrastructureReservePct === undefined ? current.infrastructureReservePct : Number(body.infrastructureReservePct),
      minimumChargeCredits: body.minimumChargeCredits === undefined ? current.minimumChargeCredits : Number(body.minimumChargeCredits),
      priceMaxAgeHours: body.priceMaxAgeHours === undefined ? current.priceMaxAgeHours : Number(body.priceMaxAgeHours),
      quoteTtlMinutes: body.quoteTtlMinutes === undefined ? current.quoteTtlMinutes : Number(body.quoteTtlMinutes),
      billingEnabled: body.billingEnabled === undefined ? current.billingEnabled : Boolean(body.billingEnabled),
    });
    if (candidate.targetGrossMarginPct + candidate.gatewayFeeReservePct >= 0.95) {
      return NextResponse.json({ success: false, error: "Margin plus gateway reserve is unsafe" }, { status: 400 });
    }

    await db.$executeRaw`
      UPDATE "CommercialPricingPolicy"
      SET
        "creditValueUsd" = ${candidate.creditValueUsd},
        "targetGrossMarginPct" = ${candidate.targetGrossMarginPct},
        "providerSafetyBufferPct" = ${candidate.providerSafetyBufferPct},
        "fxSafetyBufferPct" = ${candidate.fxSafetyBufferPct},
        "gatewayFeeReservePct" = ${candidate.gatewayFeeReservePct},
        "infrastructureReservePct" = ${candidate.infrastructureReservePct},
        "minimumChargeCredits" = ${candidate.minimumChargeCredits},
        "priceMaxAgeHours" = ${candidate.priceMaxAgeHours},
        "quoteTtlMinutes" = ${candidate.quoteTtlMinutes},
        "billingEnabled" = ${candidate.billingEnabled},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = 'default'
    `;

    if (Object.prototype.hasOwnProperty.call(body, "providerReserveBalanceUsd")) {
      const reserve = Number(body.providerReserveBalanceUsd);
      if (!Number.isFinite(reserve) || reserve < 0) {
        return NextResponse.json({ success: false, error: "Provider reserve balance must be a non-negative USD value" }, { status: 400 });
      }
      await db.systemConfig.upsert({
        where: { key: "billing.provider_reserve_balance_usd" },
        create: {
          key: "billing.provider_reserve_balance_usd",
          value: String(reserve),
          description: "Admin-entered combined provider funding balance used only for reserve coverage warnings",
        },
        update: { value: String(reserve) },
      });
    }

    return NextResponse.json({ success: true, policy: await getCommercialPricingPolicy(), summary: await billingSummary() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Could not update billing policy" }, { status: 500 });
  }
}
