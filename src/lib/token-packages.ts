import { db } from "@/lib/db";
import { TOKEN_PACKAGES, getEffectiveTokens, type TokenPackage } from "@/lib/pricing";
import {
  assertCreditPackageIsEconomicallySafe,
  getSafeCreditPackageCheckoutPrice,
} from "@/lib/package-billing-safety";

/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Token Package Service — DB-backed, admin-managed
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  The admin can adjust prices, quantities, bonuses, ordering, and active
 *  state from the admin UI WITHOUT a redeploy. This module is the single
 *  source of truth that both the public storefront (/api/payments/packages)
 *  and the admin CRUD (/api/admin/packages) go through.
 *
 *  ── Resilience ──
 *  • If the DB is unreachable or empty, the service can fall back to the
 *    hardcoded package shapes in src/lib/pricing.ts.
 *  • Fresh/default DB rows are seeded at the live billing safety floor so an
 *    old GHS sticker price cannot prevent a clean installation from seeding.
 *  • A 60-second in-memory cache keeps the public packages route fast.
 *
 *  ── Billing invariant ──
 *  • New/edited ACTIVE package prices must already cover all base + bonus
 *    credits in both USD and GHS.
 *  • Existing legacy rows are additionally protected at storefront/checkout
 *    by live upward repricing when FX or policy makes a stored price unsafe.
 *  • Inactive packages may be saved below the floor so an admin can disable
 *    or repair a legacy package without being locked out of the control plane.
 */

export interface DbTokenPackage {
  id: string;
  slug: string;
  name: string;
  tokens: number;
  priceGHS: number;
  priceUSD: number;
  bonusPct: number;
  popular: boolean;
  isActive: boolean;
  sortOrder: number;
  features: string[];
  createdAt: Date;
  updatedAt: Date;
  effectiveTokens: number;
  effectiveTokenPriceGHS: number;
  effectiveTokenPriceUSD: number;
}

export type PublicTokenPackage = DbTokenPackage;

let cache: { packages: DbTokenPackage[]; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

interface TokenPackageRow {
  id: string;
  slug: string;
  name: string;
  tokens: number;
  priceGHS: number;
  priceUSD: number;
  bonusPct: number;
  popular: boolean;
  isActive: boolean;
  sortOrder: number;
  features: string;
  createdAt: Date;
  updatedAt: Date;
}

function rowToPackage(row: TokenPackageRow): DbTokenPackage {
  let features: string[] = [];
  try {
    const parsed = JSON.parse(row.features);
    if (Array.isArray(parsed)) features = parsed.map(String);
  } catch {
    features = [];
  }
  const effectiveTokens = row.tokens + Math.round((row.tokens * row.bonusPct) / 100);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tokens: row.tokens,
    priceGHS: row.priceGHS,
    priceUSD: row.priceUSD,
    bonusPct: row.bonusPct,
    popular: row.popular,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    features,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    effectiveTokens,
    effectiveTokenPriceGHS: effectiveTokens > 0 ? row.priceGHS / effectiveTokens : 0,
    effectiveTokenPriceUSD: effectiveTokens > 0 ? row.priceUSD / effectiveTokens : 0,
  };
}

async function assertSafeIfActive(data: Pick<PackageInput, "tokens" | "bonusPct" | "priceGHS" | "priceUSD" | "isActive">): Promise<void> {
  if (!data.isActive) return;
  await assertCreditPackageIsEconomicallySafe({
    baseCredits: data.tokens,
    bonusPct: data.bonusPct,
    priceUsd: data.priceUSD,
    priceGhs: data.priceGHS,
  });
}

async function safeDefaultPackages() {
  return Promise.all(TOKEN_PACKAGES.map(async (pkg) => {
    const safe = await getSafeCreditPackageCheckoutPrice({
      baseCredits: pkg.tokens,
      bonusPct: pkg.bonusPct,
      configuredPriceUsd: pkg.priceUSD,
      configuredPriceGhs: pkg.priceGHS,
    });
    return { pkg, safe };
  }));
}

async function seedIfEmpty(): Promise<void> {
  const count = await db.tokenPackage.count();
  if (count > 0) return;

  const defaults = await safeDefaultPackages();
  await db.tokenPackage.createMany({
    data: defaults.map(({ pkg, safe }, idx) => ({
      slug: pkg.id,
      name: pkg.name,
      tokens: pkg.tokens,
      priceGHS: safe.checkoutPriceGhs,
      priceUSD: safe.checkoutPriceUsd,
      bonusPct: pkg.bonusPct,
      popular: pkg.popular,
      isActive: true,
      sortOrder: idx,
      features: JSON.stringify(pkg.features),
    })),
  });
}

export async function getAllPackagesForAdmin(): Promise<DbTokenPackage[]> {
  try {
    await seedIfEmpty();
    const rows = await db.tokenPackage.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(rowToPackage);
  } catch (err) {
    console.error("[token-packages] admin list failed, returning fallback:", err);
    return TOKEN_PACKAGES.map((pkg, idx) => {
      const effective = getEffectiveTokens(pkg);
      return {
        id: pkg.id,
        slug: pkg.id,
        name: pkg.name,
        tokens: pkg.tokens,
        priceGHS: pkg.priceGHS,
        priceUSD: pkg.priceUSD,
        bonusPct: pkg.bonusPct,
        popular: pkg.popular,
        isActive: true,
        sortOrder: idx,
        features: pkg.features,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        effectiveTokens: effective,
        effectiveTokenPriceGHS: effective > 0 ? pkg.priceGHS / effective : 0,
        effectiveTokenPriceUSD: effective > 0 ? pkg.priceUSD / effective : 0,
      } satisfies DbTokenPackage;
    });
  }
}

export async function getActivePackages(): Promise<DbTokenPackage[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.packages;

  try {
    await seedIfEmpty();
    const rows = await db.tokenPackage.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const packages = rows.map(rowToPackage);
    cache = { packages, at: Date.now() };
    return packages;
  } catch (err) {
    console.error("[token-packages] public list failed, returning fallback:", err);
    return TOKEN_PACKAGES.map((pkg, idx) => {
      const effective = getEffectiveTokens(pkg);
      return {
        id: pkg.id,
        slug: pkg.id,
        name: pkg.name,
        tokens: pkg.tokens,
        priceGHS: pkg.priceGHS,
        priceUSD: pkg.priceUSD,
        bonusPct: pkg.bonusPct,
        popular: pkg.popular,
        isActive: true,
        sortOrder: idx,
        features: pkg.features,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        effectiveTokens: effective,
        effectiveTokenPriceGHS: effective > 0 ? pkg.priceGHS / effective : 0,
        effectiveTokenPriceUSD: effective > 0 ? pkg.priceUSD / effective : 0,
      } satisfies DbTokenPackage;
    });
  }
}

export function invalidatePackageCache(): void {
  cache = null;
}

export async function getPackageBySlug(slug: string): Promise<DbTokenPackage | null> {
  try {
    const row = await db.tokenPackage.findFirst({ where: { slug, isActive: true } });
    if (!row) return null;
    return rowToPackage(row);
  } catch (err) {
    console.error("[token-packages] getBySlug failed, checking fallback:", err);
    const fallback = TOKEN_PACKAGES.find((p) => p.id === slug);
    if (!fallback) return null;
    const effective = getEffectiveTokens(fallback);
    return {
      id: fallback.id,
      slug: fallback.id,
      name: fallback.name,
      tokens: fallback.tokens,
      priceGHS: fallback.priceGHS,
      priceUSD: fallback.priceUSD,
      bonusPct: fallback.bonusPct,
      popular: fallback.popular,
      isActive: true,
      sortOrder: 0,
      features: fallback.features,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      effectiveTokens: effective,
      effectiveTokenPriceGHS: effective > 0 ? fallback.priceGHS / effective : 0,
      effectiveTokenPriceUSD: effective > 0 ? fallback.priceUSD / effective : 0,
    };
  }
}

export interface PackageInput {
  slug: string;
  name: string;
  tokens: number;
  priceGHS: number;
  priceUSD: number;
  bonusPct: number;
  popular: boolean;
  isActive: boolean;
  sortOrder: number;
  features: string[];
}

function sanitizeInput(input: Partial<PackageInput>): PackageInput {
  return {
    slug: String(input.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    name: String(input.name || "").trim(),
    tokens: Math.max(1, Math.floor(Number(input.tokens) || 0)),
    priceGHS: Math.max(0, Number(input.priceGHS) || 0),
    priceUSD: Math.max(0, Number(input.priceUSD) || 0),
    bonusPct: Math.max(0, Math.min(100, Number(input.bonusPct) || 0)),
    popular: Boolean(input.popular),
    isActive: input.isActive !== false,
    sortOrder: Math.max(0, Math.floor(Number(input.sortOrder) || 0)),
    features: Array.isArray(input.features) ? input.features.map(String) : [],
  };
}

export async function createPackage(input: Partial<PackageInput>): Promise<DbTokenPackage> {
  const data = sanitizeInput(input);
  if (!data.slug) throw new Error("Slug is required");
  if (!data.name) throw new Error("Name is required");
  await assertSafeIfActive(data);

  const row = await db.tokenPackage.create({
    data: {
      slug: data.slug,
      name: data.name,
      tokens: data.tokens,
      priceGHS: data.priceGHS,
      priceUSD: data.priceUSD,
      bonusPct: data.bonusPct,
      popular: data.popular,
      isActive: data.isActive,
      sortOrder: data.sortOrder,
      features: JSON.stringify(data.features),
    },
  });
  invalidatePackageCache();
  return rowToPackage(row);
}

export async function updatePackage(id: string, input: Partial<PackageInput>): Promise<DbTokenPackage> {
  const existing = await db.tokenPackage.findUnique({ where: { id } });
  if (!existing) throw new Error("Package not found");

  let existingFeatures: string[] = [];
  try {
    const parsed = JSON.parse(existing.features);
    if (Array.isArray(parsed)) existingFeatures = parsed.map(String);
  } catch {
    existingFeatures = [];
  }

  const data = sanitizeInput({
    slug: existing.slug,
    name: existing.name,
    tokens: existing.tokens,
    priceGHS: existing.priceGHS,
    priceUSD: existing.priceUSD,
    bonusPct: existing.bonusPct,
    popular: existing.popular,
    isActive: existing.isActive,
    sortOrder: existing.sortOrder,
    features: existingFeatures,
    ...input,
  });
  await assertSafeIfActive(data);

  const row = await db.tokenPackage.update({
    where: { id },
    data: {
      name: data.name,
      tokens: data.tokens,
      priceGHS: data.priceGHS,
      priceUSD: data.priceUSD,
      bonusPct: data.bonusPct,
      popular: data.popular,
      isActive: data.isActive,
      sortOrder: data.sortOrder,
      features: JSON.stringify(data.features),
    },
  });
  invalidatePackageCache();
  return rowToPackage(row);
}

export async function deletePackage(id: string): Promise<void> {
  await db.tokenPackage.delete({ where: { id } });
  invalidatePackageCache();
}

export async function resetToDefaults(): Promise<DbTokenPackage[]> {
  const defaults = await safeDefaultPackages();

  await db.$transaction(async (tx) => {
    await tx.tokenPackage.deleteMany({});
    await tx.tokenPackage.createMany({
      data: defaults.map(({ pkg, safe }, idx) => ({
        slug: pkg.id,
        name: pkg.name,
        tokens: pkg.tokens,
        priceGHS: safe.checkoutPriceGhs,
        priceUSD: safe.checkoutPriceUsd,
        bonusPct: pkg.bonusPct,
        popular: pkg.popular,
        isActive: true,
        sortOrder: idx,
        features: JSON.stringify(pkg.features),
      })),
    });
  });
  invalidatePackageCache();
  return getAllPackagesForAdmin();
}

export type { TokenPackage };
