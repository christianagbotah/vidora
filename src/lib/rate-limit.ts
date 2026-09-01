/**
 * Simple in-memory rate limiter.
 * 
 * Usage in API routes:
 *   import { rateLimit } from "@/lib/rate-limit";
 *   const limiter = rateLimit({ windowMs: 60_000, max: 5 });
 *   const { limited } = limiter(request);
 *   if (limited) return error response;
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Auto-cleanup every 5 minutes to prevent memory leaks
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 5 * 60 * 1000);
  // Unref so it doesn't keep the process alive
  cleanupTimer.unref();
}

export interface RateLimiterOptions {
  /** Time window in milliseconds (default: 60,000 = 1 minute) */
  windowMs?: number;
  /** Max requests per window (default: 10) */
  max?: number;
  /** Custom key generator (default: IP address) */
  keyGenerator?: (req: Request) => string;
}

export function rateLimit(opts: RateLimitOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 10;
  ensureCleanup();

  return function check(request: Request): { limited: boolean; remaining: number; resetAt: number } {
    const key = opts.keyGenerator
      ? opts.keyGenerator(request)
      : getClientIp(request);

    const now = Date.now();
    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;
    const remaining = Math.max(0, max - entry.count);

    return {
      limited: entry.count > max,
      remaining,
      resetAt: entry.resetAt,
    };
  };
}

function getClientIp(request: Request): string {
  // Check common proxy headers
  const headers = new Headers(request.headers);
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

// ── Pre-built limiters for common use cases ──

/** 5 login attempts per minute */
export const loginLimiter = rateLimit({ windowMs: 60_000, max: 5 });

/** 3 registrations per hour */
export const registerLimiter = rateLimit({ windowMs: 3_600_000, max: 3 });

/** 5 password resets per hour */
export const passwordResetLimiter = rateLimit({ windowMs: 3_600_000, max: 5 });

/** 10 AI requests per minute per IP */
export const aiLimiter = rateLimit({ windowMs: 60_000, max: 10 });
