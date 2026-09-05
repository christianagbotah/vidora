import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { deductTokensForOperation } from "@/lib/tokens";
import {
  buildProfessionalSceneDirectorPrompt,
  generateProviderText,
} from "@/lib/ai-provider-router";
import { POST as runSplitScenes } from "./legacy";

export const runtime = "nodejs";

const MAX_PROMPT_CHARS = 40_000;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Mirror the legacy parser's two local-only structured-script entry points.
 * When either pattern contains at least two scenes, the legacy handler does
 * not call a provider, so user-authored scripts remain free and unchanged.
 */
function isLocallyStructuredScript(prompt: string): boolean {
  const explicitScenes =
    prompt.match(/(?:^|\n)\s*(?:🎬\s*)?Scene\s*\d+\s*[\-–—:]+/gim)?.length ?? 0;
  if (explicitScenes >= 2) return true;

  const numberedScenes =
    prompt.match(/(?:^|\n)\s*(?:🎬\s*)?\d+[.)]\s+/gm)?.length ?? 0;
  return numberedScenes >= 2;
}

function cleanStructuredOutput(value: string): string {
  return value
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  let body: Record<string, unknown>;
  try {
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

  const structuredLocally = isLocallyStructuredScript(prompt);
  let providerDirectedPrompt = prompt;

  if (!structuredLocally) {
    const supplied = req.headers.get("idempotency-key")?.trim();
    const requestKey = supplied && IDEMPOTENCY_KEY_RE.test(supplied)
      ? supplied
      : crypto.randomUUID();
    const operationKey = `scene-split:${authResult.session.userId}:${requestKey}`;

    const deduction = await deductTokensForOperation({
      userId: authResult.session.userId,
      operation: "scene_split",
      description: "AI scene splitting, dialogue direction, and character detection",
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
    // provider twice. There is no durable result cache for scene planning yet.
    if (deduction.alreadyApplied && supplied) {
      return NextResponse.json(
        {
          success: false,
          error: "This scene-planning request was already submitted. Use a new idempotency key to run it again.",
          replayed: true,
          remainingTokens: deduction.remainingTokens,
        },
        { status: 409 }
      );
    }

    const director = buildProfessionalSceneDirectorPrompt({
      source: prompt,
      targetDuration: Math.max(10, Math.min(300, Math.round(requestedDuration))),
      projectType: typeof body.projectType === "string" ? body.projectType : undefined,
    });

    try {
      providerDirectedPrompt = cleanStructuredOutput(await generateProviderText({
        systemPrompt: director.systemPrompt,
        userPrompt: director.userPrompt,
        thinking: "enabled",
        temperature: 0.35,
        maxTokens: 6_000,
        timeoutMs: 120_000,
      }));
    } catch (error) {
      console.error("[split-scenes] provider-directed scene planning failed:", error);
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error
            ? `AI story director failed: ${error.message}`
            : "AI story director failed",
        },
        { status: 502 },
      );
    }

    // The legacy parser now acts only as a deterministic parser for the
    // provider-directed result. Fail closed instead of accidentally falling
    // through to its historical direct Z.ai call.
    if (!isLocallyStructuredScript(providerDirectedPrompt)) {
      console.error("[split-scenes] provider output was not in the required scene format");
      return NextResponse.json(
        {
          success: false,
          error: "The AI story director returned an invalid scene plan. Please try again.",
        },
        { status: 502 },
      );
    }
  }

  // Rebuild a fresh NextRequest because the original body stream has been
  // consumed for validation. The provider-directed result is intentionally
  // structured so the legacy handler takes its local parser path and never
  // performs a second provider call.
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const forwarded = new NextRequest(req.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, prompt: providerDirectedPrompt }),
  });

  return runSplitScenes(forwarded);
}
