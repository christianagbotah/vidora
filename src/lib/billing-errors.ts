import { NextResponse } from "next/server";
import { BillingSafetyError } from "@/lib/provider-cost-billing";
import { ZAIError } from "@/lib/zai";
import { adminZaiDetail, isAdminSession, zaiErrorResponse } from "@/lib/zai-errors";

interface BillingErrorContext {
  session?: unknown;
  logLabel?: string;
  fallbackStatus?: number;
  fallbackMessage?: string;
}

interface BillingHttpShape {
  status: number;
  code: string;
  message: string;
}

function billingSafetyShape(error: BillingSafetyError): BillingHttpShape {
  switch (error.code) {
    case "BILLING_DISABLED":
      return {
        status: 503,
        code: error.code,
        message: "Paid AI generation is temporarily unavailable. Please try again later.",
      };
    case "BILLING_IDEMPOTENCY_CONFLICT":
      return {
        status: 409,
        code: error.code,
        message: "This request conflicts with an existing billing operation. Refresh and try again.",
      };
    case "BILLING_REPLAY_REQUIRES_RECONCILIATION":
      return {
        status: 409,
        code: error.code,
        message: "This AI request may already have been submitted and will not be submitted twice automatically. Refresh before retrying.",
      };
    case "INVALID_BILLING_QUANTITY":
    case "INVALID_ASR_DURATION":
      return {
        status: 422,
        code: error.code,
        message: "The requested AI operation has invalid billing input. Review the request and try again.",
      };
    case "BILLING_POLICY_UNAVAILABLE":
    case "UNKNOWN_PROVIDER_PRICE":
    case "INVALID_PROVIDER_PRICE":
    case "STALE_PROVIDER_PRICE":
    case "UNPRICED_TEXT_PROVIDER":
    case "INVALID_PROVIDER_COST":
    case "UNSAFE_MARGIN_POLICY":
      return {
        status: 503,
        code: error.code,
        message: "This AI feature is temporarily unavailable while billing and provider pricing are verified. Please try again later.",
      };
    default:
      return {
        status: 503,
        code: "BILLING_SAFETY_BLOCKED",
        message: "This AI operation is temporarily unavailable because a billing safety check could not be completed.",
      };
  }
}

function knownReservationShape(error: Error): BillingHttpShape | null {
  const insufficient = /^Insufficient credits\. Need (\d+), have (\d+)$/.exec(error.message);
  if (insufficient) {
    return {
      status: 402,
      code: "INSUFFICIENT_CREDITS",
      message: `You need ${insufficient[1]} credits for this operation but currently have ${insufficient[2]}.`,
    };
  }
  if (error.message === "Billing quote expired; request a fresh cost quote") {
    return {
      status: 409,
      code: "BILLING_QUOTE_EXPIRED",
      message: "The cost quote expired. Refresh the price and confirm it again before continuing.",
    };
  }
  if (error.message === "Provider pricing changed after this quote was issued; request a fresh cost quote") {
    return {
      status: 409,
      code: "BILLING_QUOTE_STALE",
      message: "Provider pricing changed after this quote was created. Refresh the price and confirm it again before continuing.",
    };
  }
  return null;
}

/**
 * Convert provider/billing failures into customer-safe HTTP responses.
 *
 * Billing safety errors deliberately expose stable machine codes, never their
 * internal diagnostic messages. Z.ai errors keep the existing safe mapping.
 * Unknown exceptions are logged and only exposed through adminDetail to an
 * authenticated administrator.
 */
export function providerBillingErrorResponse(
  error: unknown,
  context: BillingErrorContext = {},
): NextResponse {
  if (error instanceof ZAIError) {
    return zaiErrorResponse(error, context);
  }

  const shape = error instanceof BillingSafetyError
    ? billingSafetyShape(error)
    : error instanceof Error
      ? knownReservationShape(error)
      : null;

  const isAdmin = isAdminSession(context.session);
  const detail = adminZaiDetail(error);
  const body: {
    success: false;
    error: string;
    code?: string;
    adminDetail?: string;
  } = {
    success: false,
    error: shape?.message || context.fallbackMessage || "The AI operation could not be completed. Please try again later.",
  };

  if (shape?.code) body.code = shape.code;
  if (isAdmin) body.adminDetail = detail;
  console.error(`[${context.logLabel || "billing-error"}]`, detail);

  return NextResponse.json(body, {
    status: shape?.status ?? context.fallbackStatus ?? 500,
  });
}
