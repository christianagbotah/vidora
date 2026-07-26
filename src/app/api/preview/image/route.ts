import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { zai, ZAIError } from "@/lib/zai";
import { applyWatermark } from "@/lib/watermark";
import { consumePreviewQuota, refundPreviewQuota } from "@/lib/preview-limit";
import { db } from "@/lib/db";
import { PRICING } from "@/lib/pricing";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

/**
 * POST /api/preview/image
 *
 * Generates ONE watermarked, low-resolution still image from a scene prompt —
 * FREE (no tokens). This is the second step of the "try before you buy" funnel:
 *
 *   User sees storyboard → requests a visual style preview
 *   → AI generates ONE image → watermark is applied → returned to UI
 *
 * The watermark (diagonal "VIDORA • PREVIEW" + badges) makes the image
 * commercially unusable, so users must buy tokens for the clean, full-HD,
 * multi-scene video.
 *
 * Cost to owner: ~$0.03 (one image generation). Rate-limited: 3/day.
 */

// Preview images are always generated at a fixed small size to keep them
// clearly "preview quality" (not usable as a final product).
const PREVIEW_SIZE = "1024x1024" as const;

export async function POST(req: NextRequest) {
  // ── Auth ──
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "Please sign in to generate a free preview." },
      { status: 401 }
    );
  }
  const userId = (session.user as Record<string, unknown>).id as string;

  // ── Parse input ──
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const style = typeof body.style === "string" ? body.style : "cinematic";

  if (prompt.length < 10) {
    return NextResponse.json(
      { success: false, error: "A scene description of at least 10 characters is required." },
      { status: 400 }
    );
  }
  if (prompt.length > 2000) {
    return NextResponse.json(
      { success: false, error: "Scene description is too long (max 2000 characters)." },
      { status: 400 }
    );
  }

  // ── Rate limit (daily free quota — stricter for images since they cost more) ──
  const quota = await consumePreviewQuota(userId, "image");
  if (!quota.ok) {
    return NextResponse.json(
      {
        success: false,
        error: quota.reason,
        previewQuota: quota,
      },
      { status: 429 }
    );
  }

  // ── Augment the prompt with the chosen style for a cohesive look ──
  const styledPrompt = `${prompt}. Visual style: ${style}, cinematic lighting, high quality, detailed.`;

  // ── Generate the image via Z.ai ──
  let imageBase64: string;
  try {
    imageBase64 = await zai.generateImage({
      prompt: styledPrompt,
      size: PREVIEW_SIZE,
      retry: { label: "Preview image generation", timeoutMs: 120_000, maxRetries: 3 },
    });
  } catch (err) {
    // Server-side failure (Z.ai down / insufficient balance) — refund quota
    // so the user isn't penalized for a failure that wasn't their fault.
    await refundPreviewQuota(userId, "image");
    const message = err instanceof ZAIError ? err.message : "Image generation failed.";
    return NextResponse.json(
      { success: false, error: message, previewQuota: quota },
      { status: 502 }
    );
  }

  // ── Apply the watermark ──
  let watermarkedBuffer: Buffer;
  try {
    const rawBuffer = Buffer.from(imageBase64, "base64");
    watermarkedBuffer = await applyWatermark(rawBuffer);
  } catch (err) {
    // Watermarking failed — refund quota (server-side processing error)
    await refundPreviewQuota(userId, "image");
    const message = err instanceof Error ? err.message : "Watermarking failed.";
    return NextResponse.json(
      { success: false, error: `Failed to process preview image: ${message}`, previewQuota: quota },
      { status: 500 }
    );
  }

  // ── Persist the watermarked image to /public/generated/previews ──
  // We store it so the frontend can reference it by URL. These are deliberately
  // low-res + watermarked, so even if shared they have no commercial value.
  const outputDir = path.join(process.cwd(), "public", "generated", "previews");
  await mkdir(outputDir, { recursive: true });
  const filename = `preview_${userId}_${Date.now()}.jpg`;
  await writeFile(path.join(outputDir, filename), watermarkedBuffer);
  const publicUrl = `/generated/previews/${filename}`;

  // ── Record the (free) cost for analytics so the owner sees CAC ──
  await db.tokenTransaction.create({
    data: {
      userId,
      type: "spend",
      amount: 0, // free
      description: `Free watermarked image preview`,
      costUsd: PRICING.preview_image.costUsd,
      operationType: "preview_image",
    },
  }).catch(() => { /* non-fatal */ });

  return NextResponse.json({
    success: true,
    imageUrl: publicUrl,
    watermarked: true,
    previewQuota: quota,
  });
}
