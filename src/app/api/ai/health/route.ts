import { NextResponse } from "next/server";
import { zai, ZAIError } from "@/lib/zai";

/**
 * AI Service Health Check
 *
 * Makes a minimal Z.ai chat call to verify:
 *  1. The .z-ai-config is present and valid (auth)
 *  2. The Z.ai API endpoint is reachable (network)
 *  3. The account has balance / resource package (billing)
 *
 * The result is cached in-memory for 5 minutes to avoid burning
 * API quota on every page load or polling cycle.
 *
 * Response shape:
 *  { status: "ok" | "degraded" | "down", message: string, checkedAt: number }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── In-memory cache (5 min TTL) ────────────────────────────────────────────
interface HealthCache {
  status: "ok" | "degraded" | "down";
  message: string;
  checkedAt: number;
}

let cached: HealthCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  // Return cached result if fresh
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      ...cached,
      cached: true,
    });
  }

  try {
    // Minimal chat call — 1 token of output, thinking disabled for speed/cost
    const result = await zai.chat({
      systemPrompt: "You are a health-check endpoint. Reply with exactly: OK",
      userPrompt: "ping",
      thinking: "disabled",
      retry: {
        label: "AI health check",
        maxRetries: 1,
        timeoutMs: 15_000,
      },
    });

    // If we got here without throwing, the service is healthy
    cached = {
      status: "ok",
      message: "AI service is operational",
      checkedAt: Date.now(),
    };

    return NextResponse.json(cached);
  } catch (err) {
    const isZAIError = err instanceof ZAIError;
    const kind = isZAIError ? err.kind : "unknown";
    const message = isZAIError ? err.message : "AI service check failed";

    // Classify the failure
    let status: HealthCache["status"] = "down";
    if (kind === "auth") {
      // Insufficient balance / invalid key — service is up but not usable
      status = "degraded";
    } else if (kind === "rate_limit") {
      // Rate limited — service is up, just throttled
      status = "degraded";
    }

    cached = {
      status,
      message,
      checkedAt: Date.now(),
    };

    // Return 200 even on failure — the health endpoint itself is working;
    // the *body* describes the AI service state. This prevents the browser
    // from showing a network error and lets the UI display the message.
    return NextResponse.json(cached);
  }
}
