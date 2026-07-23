import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const SIZE_MAP: Record<string, string> = {
  "16:9": "1344x768",
  "9:16": "768x1344",
  "1:1": "1024x1024",
  "4:3": "1152x864",
  "21:9": "1440x720",
};

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    // Update project status to generating
    await db.videoProject.update({
      where: { id: projectId },
      data: { status: "generating" },
    });

    const zai = await ZAI.create();
    const outputDir = path.join(process.cwd(), "public", "generated");
    await mkdir(outputDir, { recursive: true });

    const imageSize = SIZE_MAP[project.aspectRatio] || "1344x768";
    const updatedScenes = [];

    for (const scene of project.scenes) {
      try {
        // Update scene status to generating
        await db.videoScene.update({
          where: { id: scene.id },
          data: { status: "generating" },
        });

        const scenePrompt =
          scene.enhancedPrompt || scene.prompt;

        const response = await zai.images.generations.create({
          prompt: scenePrompt,
          size: imageSize,
        });

        const imageBase64 = response.data[0].base64;
        const buffer = Buffer.from(imageBase64, "base64");

        const filename = `scene_${Date.now()}_${scene.sceneNumber}.png`;
        const filepath = path.join(outputDir, filename);
        await writeFile(filepath, buffer);

        const imageUrl = `/generated/${filename}`;

        const updated = await db.videoScene.update({
          where: { id: scene.id },
          data: {
            imageUrl,
            status: "completed",
          },
        });

        updatedScenes.push(updated);
      } catch (err) {
        console.error(`Failed to generate scene ${scene.sceneNumber}:`, err);
        await db.videoScene.update({
          where: { id: scene.id },
          data: { status: "failed" },
        });
        updatedScenes.push({ ...scene, status: "failed" });
      }
    }

    // Update project status
    const allCompleted = updatedScenes.every(
      (s) => s.status === "completed"
    );
    await db.videoProject.update({
      where: { id: projectId },
      data: { status: allCompleted ? "completed" : "failed" },
    });

    // Save to generation history
    const firstScene = project.scenes[0];
    if (firstScene) {
      await db.generationHistory.create({
        data: {
          prompt: firstScene.prompt,
          inputType: "text",
          style: project.style,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `Generated ${updatedScenes.filter((s) => s.status === "completed").length} of ${updatedScenes.length} scenes`,
      scenes: updatedScenes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to generate video:", error);
    // Reset project status on failure
    try {
      const body = await req.clone().json().catch(() => null);
      if (body?.projectId) {
        await db.videoProject.update({ where: { id: body.projectId }, data: { status: "draft" } });
      }
    } catch {}
    return NextResponse.json(
      { success: false, error: "Failed to generate video: " + message },
      { status: 500 }
    );
  }
}
