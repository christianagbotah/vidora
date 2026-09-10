import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/project-auth";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { saveGeneratedFile } from "@/lib/generated-store";
import { resolveZaiImageBillingModel } from "@/lib/zai-billing-models";
import { captureImmediateProviderOperation, reserveImmediateProviderOperation } from "@/lib/immediate-provider-billing";
import { submitBilledZaiImage } from "@/lib/zai-billed-client";

export const runtime = "nodejs";
const SUPPORTED_SIZES = ["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"] as const;

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const size = typeof body.size === "string" ? body.size : "";
    if (!prompt) return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
    if (prompt.length > 4_000) return NextResponse.json({ success: false, error: "Prompt is too long" }, { status: 413 });

    const imageSize = (SUPPORTED_SIZES as readonly string[]).includes(size) ? size : "1344x768";
    const operationId = crypto.randomUUID();
    const model = resolveZaiImageBillingModel();
    const lineKey = `image:${operationId}`;
    const billing = await reserveImmediateProviderOperation({
      userId: authResult.session.userId,
      referenceId: operationId,
      provider: "zai",
      model,
      operation: "image_generation",
      quantity: 1,
      lineKey,
      label: "Standalone AI scene image",
      idempotencyKey: `scene-image:${operationId}:reservation`,
    });

    const imageBase64 = await submitBilledZaiImage({
      model,
      prompt,
      size: imageSize,
      timeoutMs: 120_000,
    });
    const capture = await captureImmediateProviderOperation({
      reservationId: billing.reservation.id,
      lineKey,
      userId: authResult.session.userId,
    });
    const imageUrl = await saveGeneratedFile(
      `users/${authResult.session.userId}/scene_${Date.now()}_${operationId.slice(0, 8)}.png`,
      Buffer.from(imageBase64, "base64"),
    );

    return NextResponse.json({
      success: true,
      imageUrl,
      providerModel: model,
      tokensCharged: capture.alreadyCaptured ? 0 : capture.creditsCaptured,
      remainingTokens: billing.wallet.availableCredits,
    });
  } catch (error) {
    // The provider request is single-submit. An ambiguous failure leaves the
    // reservation held for reconciliation; Vidora never resubmits or refunds
    // blindly after the paid boundary may have been crossed.
    return zaiErrorResponse(error, { session: authResult.session, logLabel: "generate-scene" });
  }
}
