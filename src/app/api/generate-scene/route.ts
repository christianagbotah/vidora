import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
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
];

export async function POST(req: NextRequest) {
  try {
    const { prompt, size } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: "Prompt is required" },
        { status: 400 }
      );
    }

    const imageSize = SUPPORTED_SIZES.includes(size) ? size : "1344x768";

    const zai = await ZAI.create();
    const response = await zai.images.generations.create({
      prompt,
      size: imageSize,
    });

    const imageBase64 = response.data[0].base64;
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
    console.error("Failed to generate scene:", error);
    return NextResponse.json(
      { success: false, error: "Failed to generate scene" },
      { status: 500 }
    );
  }
}
