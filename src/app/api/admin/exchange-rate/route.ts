import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * ── Admin Exchange Rate API ──
 *
 * Fetches the live GHS → USD exchange rate from a free public API.
 * Falls back to the last known rate (stored in SystemConfig) if the
 * external API is unavailable.
 *
 * Rate is cached in memory + DB. Refreshed every 4 hours.
 *
 * GET  — returns the current rate, source, and derived conversions
 * PUT  — admin can manually override the rate
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
let memoryCache: { rate: number; at: number } | null = null;

async function getFallbackRate(): Promise<number> {
  try {
    const config = await db.systemConfig.findUnique({
      where: { key: "exchange_rate_ghs_usd" },
    });
    if (config?.value) {
      const parsed = parseFloat(config.value);
      if (parsed > 0) return parsed;
    }
  } catch {
    // DB unavailable
  }
  return 15.0;
}

async function persistRate(rate: number): Promise<void> {
  try {
    await db.systemConfig.upsert({
      where: { key: "exchange_rate_ghs_usd" },
      update: { value: String(rate) },
      create: {
        key: "exchange_rate_ghs_usd",
        value: String(rate),
        description: "Live GHS to USD exchange rate (1 USD = X GHS). Updated automatically every 4 hours.",
      },
    });
  } catch (err) {
    console.error("[exchange-rate] Failed to persist rate:", err);
  }
}

async function fetchLiveRate(): Promise<number | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.error(`[exchange-rate] API returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data?.result === "success" && data?.rates?.GHS) {
      return data.rates.GHS;
    }
    return null;
  } catch (err) {
    console.error("[exchange-rate] Fetch failed:", err);
    return null;
  }
}

async function getCurrentRate(): Promise<{ rate: number; source: "live" | "cache" | "fallback" }> {
  if (memoryCache && Date.now() - memoryCache.at < CACHE_TTL_MS) {
    return { rate: memoryCache.rate, source: "cache" };
  }

  const liveRate = await fetchLiveRate();
  if (liveRate && liveRate > 0) {
    memoryCache = { rate: liveRate, at: Date.now() };
    persistRate(liveRate);
    return { rate: liveRate, source: "live" };
  }

  const fallback = await getFallbackRate();
  if (!memoryCache) {
    memoryCache = { rate: fallback, at: Date.now() - CACHE_TTL_MS + 60_000 };
  }
  return { rate: fallback, source: "fallback" };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }
    const role = (session.user as Record<string, unknown>).role as string;
    if (role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const { rate, source } = await getCurrentRate();
    const rateInverse = rate > 0 ? 1 / rate : 0;

    return NextResponse.json({
      success: true,
      data: {
        ghsPerUsd: Math.round(rate * 1000) / 1000,
        usdPerGhs: Math.round(rateInverse * 10000) / 10000,
        source,
        lastChecked: memoryCache ? new Date(memoryCache.at).toISOString() : null,
        cacheTTLMinutes: CACHE_TTL_MS / 60_000,
      },
    });
  } catch (error) {
    console.error("Exchange rate API error:", error);
    const fallback = await getFallbackRate();
    return NextResponse.json({
      success: true,
      data: {
        ghsPerUsd: fallback,
        usdPerGhs: Math.round((1 / fallback) * 10000) / 10000,
        source: "fallback",
        lastChecked: null,
        cacheTTLMinutes: CACHE_TTL_MS / 60_000,
      },
    });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }
    const role = (session.user as Record<string, unknown>).role as string;
    if (role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const rate = Number(body.rate);
    if (!rate || rate <= 0) {
      return NextResponse.json({ success: false, error: "Invalid rate" }, { status: 400 });
    }

    memoryCache = { rate, at: Date.now() };
    await persistRate(rate);

    return NextResponse.json({
      success: true,
      data: {
        ghsPerUsd: Math.round(rate * 1000) / 1000,
        usdPerGhs: Math.round((1 / rate) * 10000) / 10000,
        source: "manual",
        lastChecked: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Exchange rate update error:", error);
    return NextResponse.json({ success: false, error: "Failed to update rate" }, { status: 500 });
  }
}
