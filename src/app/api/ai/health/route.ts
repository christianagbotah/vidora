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

function publicReadiness(): HealthCache {
  const configured = Boolean(process.env.ZAI_API_KEY?.trim());
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
