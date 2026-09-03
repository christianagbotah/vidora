import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { zai } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { saveGeneratedFile } from "@/lib/generated-store";

export const runtime = "nodejs";

const SUPPORTED_SIZES = [
  "1024x1024",
  "768x1344",
  "864x1152",
  "1344x768",
  "1152x864",
  "1440x720",
  "720x1440",
] as const;

export async function POST(req: NextRequest) {
  try {
    const { prompt, size } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }

    const imageSize = (SUPPORTED_SIZES as readonly string[]).includes(size) ? size : "1344x768";

    const imageBase64 = await zai.generateImage({
      prompt,
      size: imageSize as "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440",
      retry: { label: "Generate scene image", timeoutMs: 120_000, maxRetries: 4 },
    });

    const buffer = Buffer.from(imageBase64, "base64");

    const filename = `scene_${Date.now()}.png`;
    const imageUrl = await saveGeneratedFile(filename, buffer);

    return NextResponse.json({
      success: true,
      imageUrl,
    });
  } catch (error) {
    const session = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, {
      session,
      logLabel: "generate-scene",
    });
  }
}
