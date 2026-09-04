/** Simple single-process rate limiter. Distributed replacement is tracked in the hardening PR. */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 5 * 60 * 1000);
  cleanupTimer.unref();
}

export interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: Request) => string;
}

export function rateLimit(opts: RateLimiterOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 10;
  ensureCleanup();

  return function check(request: Request): { limited: boolean; remaining: number; resetAt: number } {
    const key = opts.keyGenerator ? opts.keyGenerator(request) : getClientIp(request);
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count++;
    return {
      limited: entry.count > max,
      remaining: Math.max(0, max - entry.count),
      resetAt: entry.resetAt,
    };
  };
}

function getClientIp(request: Request): string {
  const headers = new Headers(request.headers);
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return headers.get("x-real-ip") || "unknown";
}

export const loginLimiter = rateLimit({ windowMs: 60_000, max: 5 });
export const registerLimiter = rateLimit({ windowMs: 3_600_000, max: 3 });
export const passwordResetLimiter = rateLimit({ windowMs: 3_600_000, max: 5 });
export const aiLimiter = rateLimit({ windowMs: 60_000, max: 10 });
