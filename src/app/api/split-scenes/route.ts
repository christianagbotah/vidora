import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { deductTokensForOperation } from "@/lib/tokens";
import { POST as runSplitScenes } from "./legacy";

export const runtime = "nodejs";

const MAX_PROMPT_CHARS = 40_000;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Mirror the legacy parser's two local-only structured-script entry points.
 * When either pattern contains at least two scenes, the legacy handler does
 * not call Z.ai, so this path remains free. Everything else is a provider
 * operation and must be metered before the provider can be reached.
 */
function isLocallyStructuredScript(prompt: string): boolean {
  const explicitScenes =
    prompt.match(/(?:^|\n)\s*(?:🎬\s*)?Scene\s*\d+\s*[\-–—:]+/gim)?.length ?? 0;
  if (explicitScenes >= 2) return true;

  const numberedScenes =
    prompt.match(/(?:^|\n)\s*(?:🎬\s*)?\d+[.)]\s+/gm)?.length ?? 0;
  return numberedScenes >= 2;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  let forwarded: NextRequest;
  let body: Record<string, unknown>;
  try {
    forwarded = req.clone();
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return NextResponse.json(
      { success: false, error: "A valid JSON request body is required" },
      { status: 400 }
    );
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json(
      { success: false, error: "Prompt is required" },
      { status: 400 }
    );
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json(
      { success: false, error: `Prompt is too long (max ${MAX_PROMPT_CHARS} characters)` },
      { status: 413 }
    );
  }

  const requestedDuration = Number(body.targetDuration ?? 60);
  if (!Number.isFinite(requestedDuration)) {
    return NextResponse.json(
      { success: false, error: "targetDuration must be a number" },
      { status: 400 }
    );
  }

  if (!isLocallyStructuredScript(prompt)) {
    const supplied = req.headers.get("idempotency-key")?.trim();
    const requestKey = supplied && IDEMPOTENCY_KEY_RE.test(supplied)
      ? supplied
      : crypto.randomUUID();
    const operationKey = `scene-split:${authResult.session.userId}:${requestKey}`;

    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "scene_split",
      description: "AI scene splitting and character detection",
      referenceId: requestKey,
      idempotencyKey: operationKey,
    });

    if (!deduction.success) {
      return NextResponse.json(
        { success: false, error: deduction.error || "Insufficient tokens" },
        { status: 402 }
      );
    }

    // A repeated client-supplied idempotency key must never trigger the
    // provider twice. The legacy endpoint has no durable result cache yet,
    // so fail closed rather than creating uncharged provider spend.
    if (deduction.alreadyApplied && supplied) {
      return NextResponse.json(
        {
          success: false,
          error: "This scene-splitting request was already submitted. Use a new idempotency key to run it again.",
          replayed: true,
          remainingTokens: deduction.remainingTokens,
        },
        { status: 409 }
      );
    }
  }

  return runSplitScenes(forwarded);
}
