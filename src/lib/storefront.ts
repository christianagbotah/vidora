import { db } from "@/lib/db";
import { VIDEO_MODELS, getVideoModelInfo, DEFAULT_VIDEO_MODEL_ID, type VideoModelId } from "@/lib/video-models";
import { PRICING } from "@/lib/pricing";

/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Storefront Pricing Service (admin-managed)
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Everything money-facing that the admin controls lives here:
 *
 *    1. CHARGE CURRENCY  — GHS or USD (SystemConfig `store.currency`).
 *                          Drives which price is displayed across the
 *                          homepage, engine picker, and Buy Tokens page,
 *                          and which currency the payment gateway charges.
 *    2. ENGINE PRICING   — per-clip price + token cost for EACH video
 *                          engine (CogVideoX-3, Vidu 2, ViduQ1...).
 *                          `tokensPerClip` is what generation actually
 *                          deducts; the money prices are storefront display.
 *    3. HOMEPAGE PLANS   — the marketing pricing cards on the homepage
 *                          ("Simple, Transparent Pricing"): name, badge,
 *                          price, billing period, feature bullets, CTA.
 *
 *  ── Resilience ──
 *  Every read falls back to hardcoded defaults when the DB is unreachable
 *  or empty, so the storefront never breaks. A 60s in-memory cache keeps
 *  the public route fast; admin writes invalidate it immediately.
 * ───────────────────────────────────────────────────────────────────────────
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type StorefrontCurrency = "GHS" | "USD";

export const CURRENCIES: { code: StorefrontCurrency; label: string; symbol: string; hint: string }[] = [
  { code: "GHS", label: "Ghana Cedi", symbol: "GH₵", hint: "Mobile Money friendly (MTN, Vodafone)" },
  { code: "USD", label: "US Dollar", symbol: "$", hint: "International cards (Visa, Mastercard)" },
];

export function currencySymbol(code: string): string {
  return code === "USD" ? "$" : "GH₵";
}

/** One engine's full pricing row (catalog metadata + admin-set numbers). */
export interface EnginePricingEntry {
  modelId: string;
  name: string;
  familyLabel: string;
  tierLabel: string;
  resolution: string;
  durationSec: number;
  /** Reference: what Z.ai charges YOU per clip (COGS, USD). */
  zaiCostUsd: number;
  /** Admin-set display price per clip. */
  priceGHS: number;
  priceUSD: number;
  /** Admin-set token charge per clip (deducted at generation). */
  tokensPerClip: number;
  /** Admin-set: engine offered in the picker. */
  isActive: boolean;
  isDefault: boolean;
  /** Derived margin at the current USD price. */
  marginPct: number;
}

/** A homepage pricing plan card. */
export interface StorefrontPlan {
  id: string;
  slug: string;
  name: string;
  badge: string | null;
  priceGHS: number;
  priceUSD: number;
  period: string;
  features: string[];
  ctaLabel: string;
  ctaAction: string;
  highlight: boolean;
  isActive: boolean;
  sortOrder: number;
  updatedAt: Date;
}

export interface StorefrontData {
  currency: StorefrontCurrency;
  plans: StorefrontPlan[];
  engines: EnginePricingEntry[];
}

// ─── Default seeds (mirror the previous hardcoded UI) ──────────────────────

const CURRENCY_CONFIG_KEY = "store.currency";

/** Engine seed prices: tokensPerClip × GHS 0.50 / USD 0.05 per token. */
const ENGINE_SEEDS: Record<string, { priceGHS: number; priceUSD: number; tokensPerClip: number }> = {
  "CogVideoX-3":     { priceGHS: 1.5, priceUSD: 0.15, tokensPerClip: 3 }, // matches PRICING.video_gen (3 tokens)
  "viduq1-text":     { priceGHS: 4.0, priceUSD: 0.4,  tokensPerClip: 8 },
  "viduq1-image":    { priceGHS: 4.0, priceUSD: 0.4,  tokensPerClip: 8 },
  "vidu2-image":     { priceGHS: 2.0, priceUSD: 0.2,  tokensPerClip: 4 },
  "vidu2-reference": { priceGHS: 4.0, priceUSD: 0.4,  tokensPerClip: 8 },
};

/** Homepage plan seeds — exactly the cards that shipped on the homepage. */
const PLAN_SEEDS: Omit<StorefrontPlan, "id" | "updatedAt">[] = [
  {
    slug: "starter",
    name: "Starter",
    badge: "FREE",
    priceGHS: 0,
    priceUSD: 0,
    period: "forever",
    features: ["100 Free Tokens", "5 projects", "720p export", "Basic styles", "Community support"],
    ctaLabel: "Get Started",
    ctaAction: "create",
    highlight: false,
    isActive: true,
    sortOrder: 0,
  },
  {
    slug: "pro",
    name: "Pro",
    badge: "POPULAR",
    priceGHS: 150,
    priceUSD: 9.99,
    period: "month",
    features: ["2,000 Tokens", "Unlimited projects", "1080p export", "All styles + AI Director", "Priority rendering", "Email support"],
    ctaLabel: "Buy Tokens",
    ctaAction: "buy-tokens",
    highlight: true,
    isActive: true,
    sortOrder: 1,
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    badge: "BEST VALUE",
    priceGHS: 750,
    priceUSD: 49.99,
    period: "month",
    features: ["10,000 Tokens", "Unlimited everything", "4K export", "Custom AI models", "API access", "Dedicated support", "Team collaboration"],
    ctaLabel: "Contact Us",
    ctaAction: "contact",
    highlight: false,
    isActive: true,
    sortOrder: 2,
  },
];

// ─── In-memory cache ────────────────────────────────────────────────────────

let cache: { data: StorefrontData; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateStorefrontCache(): void {
  cache = null;
}

// ─── Currency ───────────────────────────────────────────────────────────────

export async function getChargeCurrency(): Promise<StorefrontCurrency> {
  try {
    const row = await db.systemConfig.findUnique({ where: { key: CURRENCY_CONFIG_KEY } });
    if (row?.value === "USD" || row?.value === "GHS") return row.value;
  } catch (err) {
    console.error("[storefront] currency read failed, defaulting to GHS:", err);
  }
  return "GHS";
}

export async function setChargeCurrency(currency: StorefrontCurrency): Promise<void> {
  const value = currency === "USD" ? "USD" : "GHS";
  const existing = await db.systemConfig.findUnique({ where: { key: CURRENCY_CONFIG_KEY } });
  if (existing) {
    await db.systemConfig.update({ where: { key: CURRENCY_CONFIG_KEY }, data: { value } });
  } else {
    await db.systemConfig.create({
      data: { key: CURRENCY_CONFIG_KEY, value, description: "Storefront charge currency (GHS | USD)" },
    });
  }
  invalidateStorefrontCache();
}

// ─── Engine pricing ─────────────────────────────────────────────────────────

/** Build the fallback engine list from the static catalog + seeds. */
function fallbackEngines(): EnginePricingEntry[] {
  return VIDEO_MODELS.map((m) => {
    const seed = ENGINE_SEEDS[m.id] ?? {
      priceGHS: PRICING.video_gen.tokens * 0.5,
      priceUSD: PRICING.video_gen.tokens * 0.05,
      tokensPerClip: PRICING.video_gen.tokens,
    };
    const marginPct = seed.priceUSD > 0
      ? ((seed.priceUSD - m.costUsd) / seed.priceUSD) * 100
      : 0;
    return {
      modelId: m.id,
      name: m.name,
      familyLabel: m.familyLabel,
      tierLabel: m.tierLabel,
      resolution: m.resolution,
      durationSec: m.durationSec,
      zaiCostUsd: m.costUsd,
      priceGHS: seed.priceGHS,
      priceUSD: seed.priceUSD,
      tokensPerClip: seed.tokensPerClip,
      isActive: true,
      isDefault: m.id === DEFAULT_VIDEO_MODEL_ID,
      marginPct: Math.round(marginPct),
    } satisfies EnginePricingEntry;
  });
}

async function seedEnginesIfEmpty(): Promise<void> {
  const count = await db.enginePricing.count();
  if (count > 0) return;
  await db.enginePricing.createMany({
    data: VIDEO_MODELS.map((m) => ({
      modelId: m.id,
      ...(ENGINE_SEEDS[m.id] ?? {
        priceGHS: PRICING.video_gen.tokens * 0.5,
        priceUSD: PRICING.video_gen.tokens * 0.05,
        tokensPerClip: PRICING.video_gen.tokens,
      }),
      isActive: true,
    })),
  });
}

function rowToEngineEntry(row: {
  modelId: string;
  priceGHS: number;
  priceUSD: number;
  tokensPerClip: number;
  isActive: boolean;
}): EnginePricingEntry | null {
  const info = getVideoModelInfo(row.modelId);
  if (!info) return null; // model removed from catalog → skip
  const marginPct = row.priceUSD > 0
    ? ((row.priceUSD - info.costUsd) / row.priceUSD) * 100
    : 0;
  return {
    modelId: row.modelId,
    name: info.name,
    familyLabel: info.familyLabel,
    tierLabel: info.tierLabel,
    resolution: info.resolution,
    durationSec: info.durationSec,
    zaiCostUsd: info.costUsd,
    priceGHS: row.priceGHS,
    priceUSD: row.priceUSD,
    tokensPerClip: row.tokensPerClip,
    isActive: row.isActive,
    isDefault: info.id === DEFAULT_VIDEO_MODEL_ID,
    marginPct: Math.round(marginPct),
  };
}

/** All engines with pricing (admin view — includes inactive). Cache-bypassing. */
export async function getEnginePricingForAdmin(): Promise<EnginePricingEntry[]> {
  try {
    await seedEnginesIfEmpty();
    const rows = await db.enginePricing.findMany();
    const byId = new Map(rows.map((r) => [r.modelId, r]));
    // Merge: every catalog model appears exactly once. A model with no DB row
    // (newly added to the catalog) falls back to its seed pricing.
    return fallbackEngines().map((entry) => {
      const row = byId.get(entry.modelId);
      if (!row) return entry;
      return rowToEngineEntry({
        modelId: row.modelId,
        priceGHS: row.priceGHS,
        priceUSD: row.priceUSD,
        tokensPerClip: row.tokensPerClip,
        isActive: row.isActive,
      }) ?? entry;
    });
  } catch (err) {
    console.error("[storefront] engine pricing read failed, using fallback:", err);
    return fallbackEngines();
  }
}

/**
 * Charge info for the generation pipeline: how many tokens one clip costs on
 * a given engine. Falls back to the flat PRICING.video_gen default when the
 * DB is unreachable or the model is unknown.
 */
export async function getEngineChargeInfo(
  modelId: string | null | undefined
): Promise<{ tokensPerClip: number; costUsdPerClip: number }> {
  const fallback = {
    tokensPerClip: PRICING.video_gen.tokens,
    costUsdPerClip: PRICING.video_gen.costUsd,
  };
  try {
    const resolved = modelId ?? DEFAULT_VIDEO_MODEL_ID;
    const row = await db.enginePricing.findUnique({ where: { modelId: resolved } });
    if (row) return { tokensPerClip: row.tokensPerClip, costUsdPerClip: row.priceUSD > 0 ? row.priceUSD : fallback.costUsdPerClip };
    // No row yet — use the static catalog cost so margins stay accurate.
    const info = getVideoModelInfo(resolved);
    if (info) return { tokensPerClip: fallback.tokensPerClip, costUsdPerClip: info.costUsd };
  } catch (err) {
    console.error("[storefront] engine charge lookup failed, using default:", err);
  }
  return fallback;
}

export interface EnginePricingInput {
  modelId: string;
  priceGHS: number;
  priceUSD: number;
  tokensPerClip: number;
  isActive: boolean;
}

/**
 * Bulk-save engine pricing (admin). Upserts every entry by modelId.
 * The default engine can never be deactivated (users must always have at
 * least one selectable engine).
 */
export async function saveEnginePricing(entries: EnginePricingInput[]): Promise<EnginePricingEntry[]> {
  for (const e of entries) {
    if (!getVideoModelInfo(e.modelId)) continue; // unknown model → skip
    const tokens = Math.max(1, Math.floor(Number(e.tokensPerClip) || 1));
    const data = {
      priceGHS: Math.max(0, Number(e.priceGHS) || 0),
      priceUSD: Math.max(0, Number(e.priceUSD) || 0),
      tokensPerClip: tokens,
      // Never allow deactivating the default engine
      isActive: e.modelId === DEFAULT_VIDEO_MODEL_ID ? true : Boolean(e.isActive),
    };
    const existing = await db.enginePricing.findUnique({ where: { modelId: e.modelId } });
    if (existing) {
      await db.enginePricing.update({ where: { modelId: e.modelId }, data });
    } else {
      await db.enginePricing.create({ data: { modelId: e.modelId, ...data } });
    }
  }
  invalidateStorefrontCache();
  return getEnginePricingForAdmin();
}

/** Reset engine pricing to the seed defaults (admin "Reset" button). */
export async function resetEnginePricing(): Promise<EnginePricingEntry[]> {
  await db.enginePricing.deleteMany({});
  await seedEnginesIfEmpty();
  invalidateStorefrontCache();
  return getEnginePricingForAdmin();
}

// ─── Homepage plans ─────────────────────────────────────────────────────────

function rowToPlan(row: {
  id: string;
  slug: string;
  name: string;
  badge: string | null;
  priceGHS: number;
  priceUSD: number;
  period: string;
  features: string;
  ctaLabel: string;
  ctaAction: string;
  highlight: boolean;
  isActive: boolean;
  sortOrder: number;
  updatedAt: Date;
}): StorefrontPlan {
  let features: string[] = [];
  try {
    const parsed = JSON.parse(row.features);
    if (Array.isArray(parsed)) features = parsed.map(String);
  } catch {
    features = [];
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    badge: row.badge,
    priceGHS: row.priceGHS,
    priceUSD: row.priceUSD,
    period: row.period,
    features,
    ctaLabel: row.ctaLabel,
    ctaAction: row.ctaAction,
    highlight: row.highlight,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt,
  };
}

function fallbackPlans(includeInactive = false): StorefrontPlan[] {
  return PLAN_SEEDS.map((p, idx) => ({
    ...p,
    id: p.slug,
    updatedAt: new Date(0),
    sortOrder: p.sortOrder ?? idx,
    isActive: includeInactive ? true : p.isActive,
  }));
}

async function seedPlansIfEmpty(): Promise<void> {
  const count = await db.pricingPlan.count();
  if (count > 0) return;
  await db.pricingPlan.createMany({
    data: PLAN_SEEDS.map((p) => ({
      slug: p.slug,
      name: p.name,
      badge: p.badge,
      priceGHS: p.priceGHS,
      priceUSD: p.priceUSD,
      period: p.period,
      features: JSON.stringify(p.features),
      ctaLabel: p.ctaLabel,
      ctaAction: p.ctaAction,
      highlight: p.highlight,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
    })),
  });
}

/** All plans (admin view — includes inactive). Cache-bypassing. */
export async function getAllPlansForAdmin(): Promise<StorefrontPlan[]> {
  try {
    await seedPlansIfEmpty();
    const rows = await db.pricingPlan.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(rowToPlan);
  } catch (err) {
    console.error("[storefront] plans admin read failed, using fallback:", err);
    return fallbackPlans(true);
  }
}

export async function getActivePlans(): Promise<StorefrontPlan[]> {
  try {
    await seedPlansIfEmpty();
    const rows = await db.pricingPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(rowToPlan);
  } catch (err) {
    console.error("[storefront] plans public read failed, using fallback:", err);
    return fallbackPlans();
  }
}

// ─── Plan write operations ──────────────────────────────────────────────────

export interface PlanInput {
  slug: string;
  name: string;
  badge: string | null;
  priceGHS: number;
  priceUSD: number;
  period: string;
  features: string[];
  ctaLabel: string;
  ctaAction: string;
  highlight: boolean;
  isActive: boolean;
  sortOrder: number;
}

const VALID_CTA_ACTIONS = new Set(["create", "buy-tokens", "contact"]);
const VALID_PERIODS = new Set(["forever", "month", "one-time"]);

function sanitizePlanInput(input: Partial<PlanInput>) {
  const ctaAction = VALID_CTA_ACTIONS.has(String(input.ctaAction)) ? String(input.ctaAction) : "create";
  const period = VALID_PERIODS.has(String(input.period)) ? String(input.period) : "month";
  return {
    slug: String(input.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    name: String(input.name || "").trim(),
    badge: input.badge ? String(input.badge).trim().slice(0, 40) : null,
    priceGHS: Math.max(0, Number(input.priceGHS) || 0),
    priceUSD: Math.max(0, Number(input.priceUSD) || 0),
    period,
    features: Array.isArray(input.features) ? input.features.map(String).filter(Boolean).slice(0, 20) : [],
    ctaLabel: String(input.ctaLabel || "Get Started").trim().slice(0, 40) || "Get Started",
    ctaAction,
    highlight: Boolean(input.highlight),
    isActive: input.isActive !== false,
    sortOrder: Math.max(0, Math.floor(Number(input.sortOrder) || 0)),
  };
}

export async function createPlan(input: Partial<PlanInput>): Promise<StorefrontPlan> {
  const data = sanitizePlanInput(input);
  if (!data.slug) throw new Error("Slug is required");
  if (!data.name) throw new Error("Name is required");
  const row = await db.pricingPlan.create({
    data: { ...data, features: JSON.stringify(data.features) },
  });
  invalidateStorefrontCache();
  return rowToPlan(row);
}

export async function updatePlan(id: string, input: Partial<PlanInput>): Promise<StorefrontPlan> {
  const data = sanitizePlanInput(input);
  const row = await db.pricingPlan.update({
    where: { id },
    data: { ...data, features: JSON.stringify(data.features) }, // slug intentionally not updatable
  });
  invalidateStorefrontCache();
  return rowToPlan(row);
}

export async function deletePlan(id: string): Promise<void> {
  await db.pricingPlan.delete({ where: { id } });
  invalidateStorefrontCache();
}

/** Reset homepage plans to the seed defaults (admin "Reset" button). */
export async function resetPlansToDefaults(): Promise<StorefrontPlan[]> {
  await db.pricingPlan.deleteMany({});
  await seedPlansIfEmpty();
  invalidateStorefrontCache();
  return getAllPlansForAdmin();
}

// ─── Combined storefront read (public, cached) ──────────────────────────────

/**
 * Everything the public storefront needs in one call: charge currency,
 * active homepage plans, and active engine pricing. Used by the homepage,
 * the create-wizard engine picker, and the Buy Tokens view.
 */
export async function getStorefrontData(): Promise<StorefrontData> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const [currency, plans, allEngines] = await Promise.all([
    getChargeCurrency(),
    getActivePlans(),
    getEnginePricingForAdmin(),
  ]);
  const data: StorefrontData = {
    currency,
    plans,
    engines: allEngines.filter((e) => e.isActive),
  };
  cache = { data, at: Date.now() };
  return data;
}

/** Admin variant — includes inactive plans/engines and the currency. */
export async function getStorefrontDataForAdmin(): Promise<StorefrontData> {
  const [currency, plans, engines] = await Promise.all([
    getChargeCurrency(),
    getAllPlansForAdmin(),
    getEnginePricingForAdmin(),
  ]);
  return { currency, plans, engines };
}
