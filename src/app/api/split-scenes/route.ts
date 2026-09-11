import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { findReservationByReference } from "@/lib/credit-reservations";
import { buildProfessionalSceneDirectorPrompt } from "@/lib/ai-provider-router";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import {
  augmentDirectorPromptWithResearch,
  enrichScenePayloadWithResearch,
  extractStrongResearchCandidates,
  researchCreativeEntities,
  type CreativeResearchDossier,
} from "@/lib/creative-research";
import {
  reserveMeteredZaiTextOperation,
  resolveConfiguredBillableZaiTextModel,
} from "@/lib/zai-metered-billing";
import { submitBilledZaiText } from "@/lib/zai-billed-client";
import { captureActualMeteredLine, finalizeMeteredReservation } from "@/lib/metered-settlement";
import { POST as runSplitScenes } from "./legacy";

export const runtime = "nodejs";
const MAX_PROMPT_CHARS = 40_000;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function hasParseableSceneBody(value: string): boolean {
  return value.replace(/\n{2,}/g, " ").trim().length > 10;
}

/**
 * Keep this gate aligned with the legacy local parser's accepted scene shapes.
 * The internal helper still contains a historical provider fallback, so the
 * public route must only invoke it with input that will deterministically take
 * the local parsing branch. Unstructured input is handled by the metered,
 * exact-model Billing v2 provider path below.
 */
function isLocallyStructuredScript(prompt: string): boolean {
  const explicitPattern = /(?:🎬\s*)?(?:Scene\s*\d+)[\s\-–—:]+([^\n]*)\n([\s\S]*?)(?=(?:🎬\s*)?(?:Scene\s*\d+)[\s\-–—:]|Final\s*Screen|$)/gi;
  const explicitScenes = [...prompt.matchAll(explicitPattern)]
    .filter((match) => hasParseableSceneBody(match[2] || "")).length;
  if (explicitScenes >= 2) return true;

  const numberedPattern = /(?:^|\n)\s*(?:🎬)?\s*\d+[.)][\s]+([\s\S]*?)(?=(?:^|\n)\s*(?:🎬)?\s*\d+[.)]|$)/gi;
  const numberedScenes = [...prompt.matchAll(numberedPattern)]
    .filter((match) => hasParseableSceneBody(match[1] || "")).length;
  return numberedScenes >= 2;
}

function cleanStructuredOutput(value: string): string {
  return value.replace(/^```(?:text|markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function inferProjectType(prompt: string, supplied: unknown): string | undefined {
  if (typeof supplied === "string" && supplied.trim()) return supplied.trim().slice(0, 80);
  if (/\b(?:commercial|advert(?:isement)?|promo(?:tion)?|marketing campaign|corporate ad|product ad)\b/i.test(prompt)) {
    return "commercial";
  }
  if (/\b(?:short story|story|film|movie|cinematic)\b/i.test(prompt)) return "story";
  return undefined;
}

function emptyResearchDossier(): CreativeResearchDossier {
  return { entities: [], totalCreditsCharged: 0, generatedAt: new Date().toISOString() };
}

async function attachResearchToResponse(
  response: NextResponse,
  dossier: CreativeResearchDossier,
  projectType?: string,
): Promise<NextResponse> {
  if (!dossier.entities.length) return response;
  let payload: Record<string, unknown>;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    return response;
  }
  const enriched = response.ok
    ? enrichScenePayloadWithResearch(payload, dossier, projectType)
    : { ...payload, researchDossier: dossier };
  return NextResponse.json(enriched, { status: response.status });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return NextResponse.json({ success: false, error: "A valid JSON request body is required" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
  if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ success: false, error: `Prompt is too long (max ${MAX_PROMPT_CHARS} characters)` }, { status: 413 });

  const requestedDuration = Number(body.targetDuration ?? 60);
  if (!Number.isFinite(requestedDuration)) return NextResponse.json({ success: false, error: "targetDuration must be a number" }, { status: 400 });

  const structuredLocally = isLocallyStructuredScript(prompt);
  const supplied = req.headers.get("idempotency-key")?.trim();
  const requestKey = supplied && IDEMPOTENCY_KEY_RE.test(supplied) ? supplied : crypto.randomUUID();
  const operationKey = `scene-split:${authResult.session.userId}:${requestKey}`;
  const projectType = inferProjectType(prompt, body.projectType);
  const projectId = typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;
  const researchMode = typeof body.researchMode === "string" ? body.researchMode.trim().toLowerCase() : "auto";

  // For the metered director path, reject an explicit HTTP replay before any
  // fresh web research can be reserved. This preserves the existing exactly-once
  // scene-planning boundary while research uses child idempotency keys.
  if (!structuredLocally && supplied) {
    const prior = await findReservationByReference(operationKey);
    if (prior) {
      return NextResponse.json({
        success: false,
        error: "This scene-planning request was already funded/submitted. Use a new idempotency key to run it again.",
        replayed: true,
      }, { status: 409 });
    }
  }

  let researchDossier = emptyResearchDossier();
  if (researchMode !== "off") {
    const candidates = extractStrongResearchCandidates(prompt);
    if (candidates.length) {
      researchDossier = await researchCreativeEntities({
        userId: authResult.session.userId,
        projectId,
        operationKey,
        source: prompt,
        candidates,
      });
    }
  }

  let providerDirectedPrompt = prompt;

  if (!structuredLocally) {
    const baseDirector = buildProfessionalSceneDirectorPrompt({
      source: prompt,
      targetDuration: Math.max(10, Math.min(300, Math.round(requestedDuration))),
      projectType,
    });
    const director = augmentDirectorPromptWithResearch({
      ...baseDirector,
      dossier: researchDossier,
      projectType,
    });

    try {
      const model = await resolveConfiguredBillableZaiTextModel();
      const lineKeyPrefix = `${operationKey}:billing`;
      const billing = await reserveMeteredZaiTextOperation({
        userId: authResult.session.userId,
        projectId,
        referenceId: operationKey,
        idempotencyKey: `${operationKey}:reservation`,
        lineKeyPrefix,
        label: "AI scene splitting, dialogue direction, and character detection",
        systemPrompt: director.systemPrompt,
        userPrompt: director.userPrompt,
        maxOutputTokens: 6_000,
        model,
        requireConfiguredPrimary: true,
      });
      const result = await submitBilledZaiText({
        model: billing.model,
        systemPrompt: director.systemPrompt,
        userPrompt: director.userPrompt,
        maxOutputTokens: 6_000,
        thinking: "enabled",
        temperature: 0.35,
        timeoutMs: 120_000,
      });
      if (!result.usage) throw new Error("Z.ai returned no usage metadata; the prepaid scene-planning reserve is held for reconciliation");
      await captureActualMeteredLine({
        reservationId: billing.reservation.id,
        lineKey: `${lineKeyPrefix}:input`,
        userId: authResult.session.userId,
        projectId,
        actualQuantity: result.usage.inputTokens,
      });
      await captureActualMeteredLine({
        reservationId: billing.reservation.id,
        lineKey: `${lineKeyPrefix}:output`,
        userId: authResult.session.userId,
        projectId,
        actualQuantity: result.usage.outputTokens,
      });
      await finalizeMeteredReservation({
        reservationId: billing.reservation.id,
        userId: authResult.session.userId,
        reason: "Scene planning actual Z.ai token usage settled",
      });
      providerDirectedPrompt = cleanStructuredOutput(result.content);
    } catch (error) {
      return providerBillingErrorResponse(error, {
        session: authResult.session,
        logLabel: "split-scenes",
        fallbackStatus: 502,
        fallbackMessage: "The AI story director could not complete this request. Please try again later.",
      });
    }

    if (!isLocallyStructuredScript(providerDirectedPrompt)) {
      console.error("[split-scenes] provider output was not in the required scene format");
      return NextResponse.json({ success: false, error: "The AI story director returned an invalid scene plan. Please try again." }, { status: 502 });
    }
  }

  const headers = new Headers(req.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  const forwarded = new NextRequest(req.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, prompt: providerDirectedPrompt }),
  });
  const response = await runSplitScenes(forwarded);
  return attachResearchToResponse(response, researchDossier, projectType);
}
