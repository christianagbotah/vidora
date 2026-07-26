import { db } from "@/lib/db";
import { TOKEN_PACKAGES, getEffectiveTokens, type TokenPackage } from "@/lib/pricing";

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
 *  • If the DB is unreachable or empty, we fall back to the hardcoded
 *    TOKEN_PACKAGES in pricing.ts so the storefront never breaks.
 *  • A 60-second in-memory cache keeps the public packages route fast —
 *    token packages change rarely, so we don't need to hit the DB on every
 *    page load. The cache is invalidated on any admin write.
 *
 *  ── Seeding ──
 *  On first access (DB has zero rows), we seed the DB with the hardcoded
 *    defaults so the admin starts from a known, sensible baseline.
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
  // Derived (computed on read so admins see live numbers as they edit)
  effectiveTokens: number;
  effectiveTokenPriceGHS: number;
  effectiveTokenPriceUSD: number;
}

/** Shape returned to the public storefront (excludes internal fields). */
export type PublicTokenPackage = DbTokenPackage;

// ── In-memory cache ──
let cache: { packages: DbTokenPackage[]; at: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60s

/** Convert a DB row (with features as JSON string) to the API shape. */
function rowToPackage(row: {
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
}): DbTokenPackage {
  let features: string[] = [];
  try {
    const parsed = JSON.parse(row.features);
    if (Array.isArray(parsed)) features = parsed.map(String);
  } catch {
    features = [];
  }
  const effectiveTokens =
    row.tokens + Math.round((row.tokens * row.bonusPct) / 100);
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

/** Seed the DB with hardcoded defaults if it's empty. Runs once. */
async function seedIfEmpty(): Promise<void> {
  const count = await db.tokenPackage.count();
  if (count > 0) return;

  await db.tokenPackage.createMany({
    data: TOKEN_PACKAGES.map((pkg, idx) => ({
      slug: pkg.id, // "starter", "basic", etc.
      name: pkg.name,
      tokens: pkg.tokens,
      priceGHS: pkg.priceGHS,
      priceUSD: pkg.priceUSD,
      bonusPct: pkg.bonusPct,
      popular: pkg.popular,
      isActive: true,
      sortOrder: idx,
      features: JSON.stringify(pkg.features),
    })),
  });
}

/**
 * Get all packages (admin view — includes inactive ones).
 * Bypasses the cache so admins always see fresh data after edits.
 */
export async function getAllPackagesForAdmin(): Promise<DbTokenPackage[]> {
  try {
    await seedIfEmpty();
    const rows = await db.tokenPackage.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(rowToPackage);
  } catch (err) {
    console.error("[token-packages] admin list failed, returning fallback:", err);
    // Fallback: treat hardcoded list as admin-shape (all active)
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

/**
 * Get active packages for the public storefront (sorted, cached).
 * This is what /api/payments/packages calls.
 */
export async function getActivePackages(): Promise<DbTokenPackage[]> {
  // Cache hit?
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.packages;
  }

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
    // Fallback to hardcoded defaults so the storefront never breaks
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

/** Invalidate the cache — call after any admin write. */
export function invalidatePackageCache(): void {
  cache = null;
}

/** Find a single active package by slug (used by checkout). */
export async function getPackageBySlug(
  slug: string
): Promise<DbTokenPackage | null> {
  try {
    const row = await db.tokenPackage.findFirst({
      where: { slug, isActive: true },
    });
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

// ── Admin write operations ──

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
    isActive: input.isActive !== false, // default true
    sortOrder: Math.max(0, Math.floor(Number(input.sortOrder) || 0)),
    features: Array.isArray(input.features) ? input.features.map(String) : [],
  };
}

export async function createPackage(
  input: Partial<PackageInput>
): Promise<DbTokenPackage> {
  const data = sanitizeInput(input);
  if (!data.slug) throw new Error("Slug is required");
  if (!data.name) throw new Error("Name is required");

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

export async function updatePackage(
  id: string,
  input: Partial<PackageInput>
): Promise<DbTokenPackage> {
  const data = sanitizeInput(input);
  const row = await db.tokenPackage.update({
    where: { id },
    data: {
      // slug is intentionally NOT updatable here — it's the stable checkout
      // reference. Admins can rename the display name; slug stays fixed so
      // existing payment links don't break.
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

/** Hard delete (use sparingly — prefer `isActive: false`). */
export async function deletePackage(id: string): Promise<void> {
  await db.tokenPackage.delete({ where: { id } });
  invalidatePackageCache();
}

/** Reset all packages to the hardcoded defaults (admin "Reset" button). */
export async function resetToDefaults(): Promise<DbTokenPackage[]> {
  await db.tokenPackage.deleteMany({});
  await db.tokenPackage.createMany({
    data: TOKEN_PACKAGES.map((pkg, idx) => ({
      slug: pkg.id,
      name: pkg.name,
      tokens: pkg.tokens,
      priceGHS: pkg.priceGHS,
      priceUSD: pkg.priceUSD,
      bonusPct: pkg.bonusPct,
      popular: pkg.popular,
      isActive: true,
      sortOrder: idx,
      features: JSON.stringify(pkg.features),
    })),
  });
  invalidatePackageCache();
  return getAllPackagesForAdmin();
}

/** Type re-export for callers that already import from pricing.ts */
export type { TokenPackage };
