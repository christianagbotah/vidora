import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cleanLLMOutput } from "@/lib/zai";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import { db } from "@/lib/db";
import { requireProjectAccess } from "@/lib/project-auth";
import { reserveMeteredTextOperation, submitBilledText } from "@/lib/metered-text-billing";
import { captureActualMeteredLine, finalizeMeteredReservation } from "@/lib/metered-settlement";

export const runtime = "nodejs";

interface ContinuityIssue {
  type: "inconsistency" | "suggestion" | "warning";
  sceneIndex: number;
  description: string;
  fix: string;
  severity: "low" | "medium" | "high";
}

export async function POST(req: NextRequest) {
  let authResult: Awaited<ReturnType<typeof requireProjectAccess>> | null = null;
  try {
    const body = await req.json();
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!projectId) return NextResponse.json({ success: false, error: "Project ID required" }, { status: 400 });

    authResult = await requireProjectAccess(projectId, false);
    if (!authResult.ok) return authResult.response;

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } }, characters: true },
    });
    if (!project) return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    if (project.scenes.length < 2) {
      return NextResponse.json({ success: true, issues: [], message: "Need at least 2 scenes to check continuity", score: 100, tokensCharged: 0 });
    }

    const sceneSummary = project.scenes.map((scene, index) => ({
      index,
      title: scene.title || `Scene ${index + 1}`,
      prompt: scene.prompt,
      visual: scene.visualNote || "",
      dialogue: scene.dialogue || "",
      mood: scene.mood || "unknown",
      camera: scene.cameraMove || "default",
    }));
    const charSummary = project.characters.map((character) => ({
      name: character.name,
      description: character.description || "",
    }));

    const systemPrompt = [
      "You are an expert Film Continuity Checker and Storyboard Editor.",
      "Analyze the following scenes for visual and narrative continuity issues.",
      "",
      "Check for:",
      "1. VISUAL INCONSISTENCIES: time-of-day changes without reason, location jumps, color palette clashes",
      "2. CHARACTER CONTINUITY: appearance changes between scenes, missing characters",
      "3. NARRATIVE FLOW: abrupt mood shifts, illogical progression, missing transitions",
      "4. CINEMATOGRAPHY: repetitive or jarring camera changes, inconsistent lighting",
      "",
      "Return ONLY valid JSON (no markdown, no code fences):",
      '{"issues":[{"type":"inconsistency|suggestion|warning","sceneIndex":0,"description":"What the issue is","fix":"How to fix it","severity":"low|medium|high"}],"score":85,"summary":"Overall assessment"}',
    ].join("\n");
    const userPrompt = `Project: ${project.title}\nStyle: ${project.style}\n\nScenes:\n${JSON.stringify(sceneSummary)}\n\nCharacters:\n${JSON.stringify(charSummary)}`;

    const operationId = crypto.randomUUID();
    const lineKeyPrefix = `continuity:${projectId}:${operationId}`;
    const billing = await reserveMeteredTextOperation({
      userId: authResult.session.userId,
      projectId,
      referenceId: projectId,
      idempotencyKey: `${lineKeyPrefix}:reservation`,
      lineKeyPrefix,
      label: `Continuity analysis for project \"${project.title}\"`,
      systemPrompt,
      userPrompt,
      maxOutputTokens: 4_000,
    });

    const result = await submitBilledText({
      provider: billing.provider,
      model: billing.model,
      systemPrompt,
      userPrompt,
      maxOutputTokens: 4_000,
      thinking: "disabled",
      timeoutMs: 60_000,
    });
    if (!result.usage) {
      throw new Error("Paid text provider returned no usage metadata; the prepaid reserve is held for reconciliation rather than guessing the charge");
    }
    const inputCapture = await captureActualMeteredLine({
      reservationId: billing.reservation.id,
      lineKey: `${lineKeyPrefix}:input`,
      userId: authResult.session.userId,
      actualQuantity: result.usage.inputTokens,
      projectId,
    });
    const outputCapture = await captureActualMeteredLine({
      reservationId: billing.reservation.id,
      lineKey: `${lineKeyPrefix}:output`,
      userId: authResult.session.userId,
      actualQuantity: result.usage.outputTokens,
      projectId,
    });
    const finalized = await finalizeMeteredReservation({
      reservationId: billing.reservation.id,
      userId: authResult.session.userId,
      reason: "Continuity analysis actual provider token usage settled",
    });

    const content = cleanLLMOutput(result.content);
    let parsed: { issues?: ContinuityIssue[]; score?: number; summary?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json({ success: false, error: "The AI returned a response that could not be parsed as JSON. Please try again." }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      issues: parsed.issues || [],
      score: parsed.score ?? 85,
      summary: parsed.summary || "Continuity check complete",
      providerModel: billing.model,
      tokensCharged: inputCapture.creditsCaptured + outputCapture.creditsCaptured,
      creditsReleased: finalized.creditsReleased,
      remainingTokens: finalized.wallet.availableCredits,
    });
  } catch (error) {
    return providerBillingErrorResponse(error, {
      session: authResult?.ok ? authResult.session : null,
      logLabel: "check-continuity",
    });
  }
}
