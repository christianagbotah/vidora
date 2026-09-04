import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { zai, ZAIError } from "@/lib/zai";

/**
 * Zero-cost public AI readiness endpoint.
 *
 * Public UI polling must never create provider spend. A live Z.ai probe is
 * available only to an authenticated current admin via ?deep=1 and is cached
 * for five minutes. Normal users receive configuration readiness only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthCache {
  status: "ok" | "degraded" | "down";
  message: string;
  checkedAt: number;
}

let deepCached: HealthCache | null = null;
const DEEP_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Mirror the client's credential resolution order (see src/lib/zai.ts):
 *   1. SystemConfig DB (zai_base_url + zai_api_key)
 *   2. ZAI_BASE_URL + ZAI_API_KEY env vars
 *   3. .z-ai-config file via ZAI.create() — dev sandbox fallback
 * Readiness checks env vars and the .z-ai-config fallback without touching
 * the DB (keeps the endpoint zero-cost and latency-free); Admin-Portal-only
 * setups still report ok via their DB rows once any deep probe runs.
 */
function publicReadiness(): HealthCache {
  const envConfigured =
    Boolean(process.env.ZAI_BASE_URL?.trim()) && Boolean(process.env.ZAI_API_KEY?.trim());
  const fileConfigured =
    existsSync(join(process.cwd(), ".z-ai-config")) || existsSync("/etc/.z-ai-config");
  const configured = envConfigured || fileConfigured;
  return {
    status: configured ? "ok" : "degraded",
    message: configured
      ? "AI service is configured"
      : "AI service is not configured",
    checkedAt: Date.now(),
  };
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("deep") !== "1") {
    return NextResponse.json({
      ...publicReadiness(),
      liveProbe: false,
    });
  }

  const admin = await requireAdmin(req);
  if (admin.error) return admin.error;

  if (deepCached && Date.now() - deepCached.checkedAt < DEEP_CACHE_TTL_MS) {
    return NextResponse.json({
      ...deepCached,
      cached: true,
      liveProbe: true,
    });
  }

  try {
    // Minimal chat call — 1 token of output, thinking disabled for speed/cost.
    // Uses the FREE GLM-4.5-Flash model (verified price sheet: Flash models
    // cost $0) so even the admin deep probe never consumes paid balance.
    await zai.chat({
      model: "glm-4.5-flash",
      systemPrompt: "You are a health-check endpoint. Reply with exactly: OK",
      userPrompt: "ping",
      thinking: "disabled",
      retry: {
        label: "Admin AI health check",
        maxRetries: 1,
        timeoutMs: 15_000,
      },
    });

    deepCached = {
      status: "ok",
      message: "AI provider responded successfully",
      checkedAt: Date.now(),
    };
  } catch (err) {
    const isZAIError = err instanceof ZAIError;
    const kind = isZAIError ? err.kind : "unknown";
    deepCached = {
      status: kind === "auth" || kind === "rate_limit" ? "degraded" : "down",
      message: isZAIError ? err.message : "AI provider health check failed",
      checkedAt: Date.now(),
    };
  }

  return NextResponse.json({
    ...deepCached,
    liveProbe: true,
  });
}
