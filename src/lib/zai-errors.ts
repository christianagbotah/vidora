/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Z.ai Error Differentiation Layer
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  When a Z.ai API call fails (e.g. 1113 insufficient balance, rate limit,
 *  network timeout, validation), we must NOT surface the raw technical error
 *  to ordinary users. Only admins (role === "admin") should see the real
 *  diagnostic detail so they can recharge the account, fix the config, etc.
 *
 *  Regular users see a friendly "service temporarily unavailable, try later"
 *  message instead of leaking internal billing/config details.
 *
 *  Response shape (returned by zaiErrorResponse):
 *    {
 *      success: false,
 *      error: "<user-friendly message>",          // always present, always safe
 *      adminDetail?: "<raw technical detail>"     // present ONLY for admins
 *    }
 *
 *  Server logs ALWAYS log the raw technical detail (regardless of caller)
 *  so the team can investigate via `pm2 logs vidora`.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { NextResponse } from "next/server";
import { ZAIError } from "./zai";

/**
 * Returns true if the given session (or session-like object) belongs to an admin.
 *
 * Handles two session shapes:
 *   1. AuthSession (from requireProjectAccess/requireSceneAccess): `{ userId, role, email }`
 *      — role is a top-level field.
 *   2. NextAuth Session (from getServerSession): `{ user: { id, role, tokens, ... }, expires }`
 *      — role is nested under `user`.
 *
 * Also accepts a bare `{ role: string }` for ad-hoc use.
 */
export function isAdminSession(
  session?: { role?: string; user?: { role?: string } } | null
): boolean {
  if (!session) return false;
  // Top-level role (AuthSession or bare object)
  if (session.role === "admin") return true;
  // Nested role (NextAuth session)
  if (session.user?.role === "admin") return true;
  return false;
}

/**
 * Map a Z.ai error to a USER-FRIENDLY message (no internal details).
 * This is what non-admin users see in toasts / chat replies.
 */
export function userFriendlyZaiMessage(error: unknown): string {
  if (error instanceof ZAIError) {
    switch (error.kind) {
      case "auth":
        // Covers: insufficient balance (1113/1112), invalid API key, missing config.
        return "This AI feature is temporarily unavailable. Our team has been notified — please try again later.";
      case "rate_limit":
        return "The AI service is busy right now. Please wait a moment and try again.";
      case "timeout":
      case "network":
        return "We couldn't reach the AI service. Please check your connection and try again.";
      case "server":
        return "The AI service is experiencing issues. Please try again in a few minutes.";
      case "validation":
        return "Your request couldn't be processed as written. Please review your input and try again.";
      case "unknown":
      default:
        return "Something went wrong on our end. Please try again later.";
    }
  }
  return "Something went wrong. Please try again later.";
}

/**
 * Build the technical detail string for admins.
 * Includes the ZAIError kind + retryability + raw message.
 */
export function adminZaiDetail(error: unknown): string {
  if (error instanceof ZAIError) {
    const retryable = error.retryable ? " (retryable)" : "";
    const status = error.status ? ` [HTTP ${error.status}]` : "";
    return `[ZAI ${error.kind}${retryable}${status}] ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Build a standardized error NextResponse that hides raw details from
 * non-admin users while still surfacing them to admins.
 *
 * @param error        The thrown error (ZAIError or anything else)
 * @param context      Optional context:
 *   - session:            the caller's auth session (for admin check)
 *   - fallbackStatus:     HTTP status to use when error is NOT a ZAIError
 *   - fallbackMessage:    override the default user-friendly message
 *   - logLabel:           prefix for the console.error line
 */
export function zaiErrorResponse(
  error: unknown,
  context: {
    session?: { role?: string; user?: { role?: string } } | null;
    fallbackStatus?: number;
    fallbackMessage?: string;
    logLabel?: string;
  } = {}
): NextResponse {
  const isAdmin = isAdminSession(context.session);
  const userMsg = context.fallbackMessage || userFriendlyZaiMessage(error);
  const detail = adminZaiDetail(error);

  const status =
    error instanceof ZAIError
      ? error.kind === "auth"
        ? 503
        : error.kind === "rate_limit"
          ? 429
          : error.kind === "validation"
            ? 422
            : 500
      : (context.fallbackStatus ?? 500);

  const body: {
    success: false;
    error: string;
    adminDetail?: string;
  } = {
    success: false,
    error: userMsg,
  };
  // Only attach adminDetail for admins — non-admins never see the raw cause.
  if (isAdmin) body.adminDetail = detail;

  // Server-side logs always carry the raw detail (for debugging via pm2 logs).
  const label = context.logLabel || "zai-error";
  console.error(`[${label}]`, detail);

  return NextResponse.json(body, { status });
}

/**
 * Pick the appropriate error string to display to the current user.
 * Use this in client-side fetch handlers.
 *
 * - Admins see `adminDetail` if present (raw diagnostic)
 * - Everyone else sees `error` (user-friendly)
 *
 * @param data           The parsed JSON body from the failed API response
 * @param isAdmin        Whether the current user is an admin
 * @param fallback       Fallback string when neither field is present
 */
export function pickApiError(
  data: { error?: string; adminDetail?: string } | null | undefined,
  isAdmin: boolean,
  fallback = "Something went wrong. Please try again."
): string {
  if (!data) return fallback;
  if (isAdmin && data.adminDetail) return data.adminDetail;
  return data.error || fallback;
}
