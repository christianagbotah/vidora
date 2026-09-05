/** Z.ai error differentiation and safe user-facing responses. */
import { NextResponse } from "next/server";
import { ZAIError } from "./zai";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** Accept both project-auth sessions and NextAuth sessions without coupling the
 * error layer to either library's concrete type declarations. */
export function isAdminSession(session?: unknown): boolean {
  const record = asRecord(session);
  if (!record) return false;
  if (record.role === "admin") return true;
  const user = asRecord(record.user);
  return user?.role === "admin";
}

export function userFriendlyZaiMessage(error: unknown): string {
  if (error instanceof ZAIError) {
    switch (error.kind) {
      case "auth":
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
      default:
        return "Something went wrong on our end. Please try again later.";
    }
  }
  return "Something went wrong. Please try again later.";
}

export function adminZaiDetail(error: unknown): string {
  if (error instanceof ZAIError) {
    const retryable = error.retryable ? " (retryable)" : "";
    const status = error.status ? ` [HTTP ${error.status}]` : "";
    return `[ZAI ${error.kind}${retryable}${status}] ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function friendlySceneError(raw: string | null | undefined): string {
  if (!raw) return "Video generation failed. Please try again.";
  if (/unsafe|sensitive content|moderation|content (filter|policy)|safety filter|flagged/i.test(raw)) {
    return "This scene's description was flagged by the AI content safety filter. Edit the scene prompt and retry. Tokens for failed scenes are refunded.";
  }
  if (/rate.?limit|too many requests/i.test(raw) || /\b429\b/.test(raw)) {
    return "The AI video service is busy right now. Please wait a few minutes and retry — failed scenes are refunded automatically.";
  }
  if (/image download fail|failed to download image|image.*download.*fail/i.test(raw)) {
    return "The AI rendering service could not download this scene's reference image. Please retry; if it continues, regenerate or re-upload the reference image.";
  }
  if (/aspect.?ratio|image (size|resolution)|resolution (mismatch|not)/i.test(raw)) {
    return "The scene's reference image didn't match the project's orientation. This is now auto-corrected — please retry the scene.";
  }
  if (/1113|1112|insufficient (balance|credit)|invalid api key/i.test(raw)) {
    return "The AI rendering service is temporarily unavailable. Our team has been notified — please try again later.";
  }
  const cleaned = raw.replace(/^API request failed with status \d+:\s*/i, "").trim();
  if (!cleaned) return "Video generation failed. Please try again.";
  return cleaned.length > 240 ? `${cleaned.slice(0, 239)}…` : cleaned;
}

export function zaiErrorResponse(
  error: unknown,
  context: {
    session?: unknown;
    fallbackStatus?: number;
    fallbackMessage?: string;
    logLabel?: string;
  } = {}
): NextResponse {
  const isAdmin = isAdminSession(context.session);
  const userMsg = context.fallbackMessage || userFriendlyZaiMessage(error);
  const detail = adminZaiDetail(error);
  const status = error instanceof ZAIError
    ? error.kind === "auth"
      ? 503
      : error.kind === "rate_limit"
        ? 429
        : error.kind === "validation"
          ? 422
          : 500
    : (context.fallbackStatus ?? 500);

  const body: { success: false; error: string; adminDetail?: string } = {
    success: false,
    error: userMsg,
  };
  if (isAdmin) body.adminDetail = detail;
  console.error(`[${context.logLabel || "zai-error"}]`, detail);
  return NextResponse.json(body, { status });
}

export function pickApiError(
  data: { error?: string; adminDetail?: string } | null | undefined,
  isAdmin: boolean,
  fallback = "Something went wrong. Please try again."
): string {
  if (!data) return fallback;
  if (isAdmin && data.adminDetail) return data.adminDetail;
  return data.error || fallback;
}
