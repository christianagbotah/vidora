import crypto from "crypto";
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

const LOCKED_CREDIT_VALUE_USD = 0.05;
const CREDIT_VALUE_EPSILON = 1e-9;

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
      WHERE "status" IN ('captured', 'settled_actual')
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

async function statePayload() {
  const [policy, providerPrices, summary] = await Promise.all([
    getCommercialPricingPolicy(),
    listProviderPrices(),
    billingSummary(),
  ]);
  return {
    success: true,
    policy,
    creditDenominationLocked: true,
    lockedCreditValueUsd: LOCKED_CREDIT_VALUE_USD,
    providerPrices: providerPrices.map((price) => ({
      ...price,
      verifiedAt: price.verifiedAt.toISOString(),
    })),
    summary,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function updateProviderPrice(input: Record<string, unknown>): Promise<void> {
  const provider = text(input.provider);
  const model = text(input.model);
  const operation = text(input.operation);
  const billingUnit = text(input.billingUnit);
  const unitPriceUsd = Number(input.unitPriceUsd);
  const unitsPerPrice = Number(input.unitsPerPrice);
  const sourceUrl = text(input.sourceUrl);
  const requestedVersion = text(input.pricingVersion);

  if (!new Set(["zai", "qwen", "fal"]).has(provider)) throw new Error("Unsupported provider price provider");
  if (!new Set([
    "video_generation",
    "image_generation",
    "tts",
    "text_input",
    "text_output",
    "vision_input",
    "vision_output",
    "asr",
    "web_search",
    "lip_sync",
  ]).has(operation)) throw new Error("Unsupported provider price operation");
  if (!new Set(["request", "image", "character", "token", "minute", "second"]).has(billingUnit)) throw new Error("Unsupported provider billing unit");
  if (!model || model.length > 160) throw new Error("Provider model is required");
  if (!Number.isFinite(unitPriceUsd) || unitPriceUsd <= 0) throw new Error("Provider unit price must be greater than zero");
  if (!Number.isFinite(unitsPerPrice) || unitsPerPrice <= 0) throw new Error("Provider units-per-price must be greater than zero");

  let parsedSource: URL;
  try {
    parsedSource = new URL(sourceUrl);
  } catch {
    throw new Error("Provider pricing source must be a valid URL");
  }
  if (parsedSource.protocol !== "https:") throw new Error("Provider pricing source must use HTTPS");

  const verifiedAt = new Date();
  const versionPrefix = requestedVersion || provider;
  const versionStamp = verifiedAt.toISOString().replace(/\D/g, "").slice(0, 14);
  const pricingVersion = `${versionPrefix}-${versionStamp}-${crypto.randomUUID().slice(0, 8)}`;
  if (pricingVersion.length > 160) throw new Error("Pricing version is too long");
  const id = crypto.randomUUID();

  await db.$executeRaw`
    INSERT INTO "ProviderPrice" (
      "id", "provider", "model", "operation", "billingUnit", "unitPriceUsd",
      "unitsPerPrice", "sourceUrl", "pricingVersion", "active", "verifiedAt",
      "effectiveFrom", "effectiveUntil", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${provider}, ${model}, ${operation}, ${billingUnit}, ${unitPriceUsd},
      ${unitsPerPrice}, ${sourceUrl}, ${pricingVersion}, TRUE, ${verifiedAt},
      CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("provider", "model", "operation") DO UPDATE SET
      "billingUnit" = EXCLUDED."billingUnit",
      "unitPriceUsd" = EXCLUDED."unitPriceUsd",
      "unitsPerPrice" = EXCLUDED."unitsPerPrice",
      "sourceUrl" = EXCLUDED."sourceUrl",
      "pricingVersion" = EXCLUDED."pricingVersion",
      "active" = TRUE,
      "verifiedAt" = EXCLUDED."verifiedAt",
      "effectiveFrom" = CURRENT_TIMESTAMP,
      "effectiveUntil" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await statePayload());
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Billing state unavailable" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json() as Record<string, unknown>;

    if (body.providerPrice && typeof body.providerPrice === "object" && !Array.isArray(body.providerPrice)) {
      await updateProviderPrice(body.providerPrice as Record<string, unknown>);
      return NextResponse.json(await statePayload());
    }

    if (Object.prototype.hasOwnProperty.call(body, "creditValueUsd")) {
      const requestedCreditValue = Number(body.creditValueUsd);
      if (!Number.isFinite(requestedCreditValue) || Math.abs(requestedCreditValue - LOCKED_CREDIT_VALUE_USD) > CREDIT_VALUE_EPSILON) {
        return NextResponse.json({
          success: false,
          error: "Vidora credit value is locked at USD 0.05 in Billing v2. Revaluing existing credits requires an explicit wallet migration.",
          code: "CREDIT_DENOMINATION_LOCKED",
        }, { status: 409 });
      }
    }

    const current = await getCommercialPricingPolicy();
    const candidate = normalizeBillingPolicy({
      ...current,
      creditValueUsd: LOCKED_CREDIT_VALUE_USD,
      targetGrossMarginPct: body.targetGrossMarginPct === undefined ? current.targetGrossMarginPct : Number(body.targetGrossMarginPct),
      providerSafetyBufferPct: body.providerSafetyBufferPct === undefined ? current.providerSafetyBufferPct : Number(body.providerSafetyBufferPct),
      fxSafetyBufferPct: body.fxSafetyBufferPct === undefined ? current.fxSafetyBufferPct : Number(body.fxSafetyBufferPct),
      gatewayFeeReservePct: body.gatewayFeeReservePct === undefined ? current.gatewayFeeReservePct : Number(body.gatewayFeeReservePct),
      infrastructureReservePct: body.infrastructureReservePct === undefined ? current.infrastructureReservePct : Number(body.infrastructureReservePct),
      minimumChargeCredits: body.minimumChargeCredits === undefined ? current.minimumChargeCredits : Number(body.minimumChargeCredits),
      priceMaxAgeHours: body.priceMaxAgeHours === undefined ? current.priceMaxAgeHours : Number(body.priceMaxAgeHours),
      quoteTtlMinutes: body.quoteTtlMinutes === undefined ? current.quoteTtlMinutes : Number(body.quoteTtlMinutes),
      billingEnabled: body.billingEnabled === undefined ? current.billingEnabled : body.billingEnabled === true,
    });
    if (candidate.targetGrossMarginPct + candidate.gatewayFeeReservePct >= 0.95) {
      return NextResponse.json({ success: false, error: "Margin plus gateway reserve is unsafe" }, { status: 400 });
    }

    await db.$executeRaw`
      UPDATE "CommercialPricingPolicy"
      SET
        "creditValueUsd" = ${LOCKED_CREDIT_VALUE_USD},
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

    return NextResponse.json(await statePayload());
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Could not update billing configuration" }, { status: 400 });
  }
}
