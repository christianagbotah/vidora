import { NextRequest, NextResponse } from "next/server";
import { zai, ZAIError } from "@/lib/zai";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

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

    // Ensure output directory exists
    const outputDir = path.join(process.cwd(), "public", "generated");
    await mkdir(outputDir, { recursive: true });

    const filename = `scene_${Date.now()}.png`;
    const filepath = path.join(outputDir, filename);
    await writeFile(filepath, buffer);

    return NextResponse.json({
      success: true,
      imageUrl: `/generated/${filename}`,
    });
  } catch (error) {
    const message = error instanceof ZAIError ? error.message : error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to generate scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate scene: " + message },
      { status: error instanceof ZAIError && error.kind === "auth" ? 503 : 500 }
    );
  }
}
