import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSceneAccess } from "@/lib/project-auth";
import { providerBillingErrorResponse } from "@/lib/billing-errors";
import { findReservationByReference } from "@/lib/credit-reservations";
import { reserveMeteredTextOperation, submitBilledText } from "@/lib/metered-text-billing";
import { captureActualMeteredLine, finalizeMeteredReservation } from "@/lib/metered-settlement";

export const runtime = "nodejs";
const MAX_LANG_LENGTH = 16;
const MAX_SRT_LENGTH = 100_000;

function subtitleFingerprint(opts: { sceneId: string; lang: string; duration: number; sourceText: string }): string {
  return crypto.createHash("sha256").update(JSON.stringify(opts), "utf8").digest("hex").slice(0, 24);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let authResult: Awaited<ReturnType<typeof requireSceneAccess>> | null = null;
  try {
    const { id } = await params;
    authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;
    const userId = authResult.session.userId;
    if (!userId || userId === "guest") return NextResponse.json({ success: false, error: "Please sign in to generate subtitles" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const lang = typeof body.lang === "string" && body.lang.trim() ? body.lang.trim().slice(0, MAX_LANG_LENGTH) : "en";
    const scene = await db.videoScene.findUnique({ where: { id }, include: { translations: { where: { lang }, take: 1 } } });
    if (!scene) return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });

    const sourceText = (lang === "en" ? (scene.dialogue || scene.prompt || "") : (scene.translations[0]?.translatedText || "")).trim();
    if (!sourceText) {
      return NextResponse.json({ success: false, error: lang === "en" ? "No narration text available for this scene" : `No ${lang} translation is available for subtitles` }, { status: 400 });
    }
    if (scene.subtitleStatus === "ready" && scene.subtitleSrt && scene.subtitleLang === lang) {
      return NextResponse.json({ success: true, srt: scene.subtitleSrt, lang, tokensCharged: 0, replayed: true });
    }

    const fingerprint = subtitleFingerprint({ sceneId: id, lang, duration: scene.duration, sourceText });
    const operationKey = `subtitles:${userId}:${id}:${fingerprint}`;
    const prior = await findReservationByReference(operationKey);
    if (prior) {
      return NextResponse.json({
        success: false,
        error: "This subtitle generation attempt was already funded/submitted and is awaiting reconciliation. Change the source text/language or resolve the previous attempt before retrying.",
        replayed: true,
      }, { status: 409 });
    }

    const systemPrompt = `You are a subtitle generator. Convert the user's narration text into SRT subtitle format. Each subtitle should be 5-8 words, displayed for 2-3 seconds. The total duration is ${scene.duration} seconds. Distribute subtitles evenly across the duration. Output ONLY valid SRT format, nothing else. No markdown fences, no explanations.\n\nSRT format example:\n1\n00:00:00,000 --> 00:00:02,500\nFirst few words here\n\n2\n00:00:02,500 --> 00:00:05,000\nNext few words here`;
    const lineKeyPrefix = `${operationKey}:billing`;
    const billing = await reserveMeteredTextOperation({
      userId,
      projectId: scene.projectId,
      sceneId: id,
      referenceId: operationKey,
      idempotencyKey: `${operationKey}:reservation`,
      lineKeyPrefix,
      label: `Generate subtitles (${lang}) for scene ${scene.sceneNumber}`,
      systemPrompt,
      userPrompt: sourceText,
      maxOutputTokens: 4_000,
    });

    await db.videoScene.update({ where: { id }, data: { subtitleStatus: "generating", subtitleLang: lang } });
    try {
      const result = await submitBilledText({
        provider: billing.provider,
        model: billing.model,
        systemPrompt,
        userPrompt: sourceText,
        maxOutputTokens: 4_000,
        thinking: "disabled",
        timeoutMs: 60_000,
      });
      if (!result.usage) throw new Error("Paid text provider returned no usage metadata; the prepaid subtitle reserve is held for reconciliation");
      const inputCapture = await captureActualMeteredLine({
        reservationId: billing.reservation.id,
        lineKey: `${lineKeyPrefix}:input`,
        userId,
        actualQuantity: result.usage.inputTokens,
        projectId: scene.projectId,
        sceneId: id,
      });
      const outputCapture = await captureActualMeteredLine({
        reservationId: billing.reservation.id,
        lineKey: `${lineKeyPrefix}:output`,
        userId,
        actualQuantity: result.usage.outputTokens,
        projectId: scene.projectId,
        sceneId: id,
      });
      const finalized = await finalizeMeteredReservation({
        reservationId: billing.reservation.id,
        userId,
        reason: "Subtitle generation actual provider token usage settled",
      });

      let srt = result.content.trim();
      if (srt.startsWith("```")) srt = srt.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/i, "").trim();
      if (!/\d{2}:\d{2}:\d{2}/.test(srt) || srt.length > MAX_SRT_LENGTH) throw new Error("LLM did not produce valid bounded SRT format");

      await db.videoScene.update({ where: { id }, data: { subtitleSrt: srt, subtitleStatus: "ready", subtitleLang: lang } });
      return NextResponse.json({
        success: true,
        srt,
        lang,
        providerModel: billing.model,
        tokensCharged: inputCapture.creditsCaptured + outputCapture.creditsCaptured,
        creditsReleased: finalized.creditsReleased,
        remainingTokens: finalized.wallet.availableCredits,
      });
    } catch (aiError) {
      await db.videoScene.update({ where: { id }, data: { subtitleStatus: "failed" } }).catch(() => undefined);
      return providerBillingErrorResponse(aiError, { session: authResult.session, logLabel: "subtitles" });
    }
  } catch (error) {
    console.error("[subtitles POST]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to generate subtitles" }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, false);
    if (!authResult.ok) return authResult.response;
    const scene = await db.videoScene.findUnique({ where: { id }, select: { subtitleSrt: true, subtitleStatus: true, subtitleLang: true, burnSubtitles: true } });
    if (!scene) return NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...scene });
  } catch (error) {
    console.error("[subtitles GET]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to load subtitles" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authResult = await requireSceneAccess(id, true);
    if (!authResult.ok) return authResult.response;
    const body = await req.json();
    const { burnSubtitles, subtitleSrt } = body;
    const data: Record<string, unknown> = {};
    if (typeof burnSubtitles === "boolean") data.burnSubtitles = burnSubtitles;
    if (subtitleSrt !== undefined) {
      if (subtitleSrt !== null && typeof subtitleSrt !== "string") return NextResponse.json({ success: false, error: "subtitleSrt must be a string or null" }, { status: 400 });
      if (typeof subtitleSrt === "string" && subtitleSrt.length > MAX_SRT_LENGTH) return NextResponse.json({ success: false, error: "Subtitle content is too large" }, { status: 413 });
      data.subtitleSrt = subtitleSrt || null;
      data.subtitleStatus = subtitleSrt ? "ready" : null;
    }
    const updated = await db.videoScene.update({ where: { id }, data });
    return NextResponse.json({ success: true, scene: updated });
  } catch (error) {
    console.error("[subtitles PUT]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Failed to update subtitles" }, { status: 500 });
  }
}
