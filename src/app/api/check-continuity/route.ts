import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

/**
 * AI Scene Continuity Checker — Analyzes all scenes in a project for visual consistency,
 * identifies contradictions (e.g., day → night without transition), and suggests fixes.
 * This is a groundbreaking feature: AI-powered storyboarding quality assurance.
 */

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxRetries) await sleep(3000 * attempt);
      else throw err;
    }
  }
  throw new Error(label + ": max retries exceeded");
}

interface ContinuityIssue {
  type: "inconsistency" | "suggestion" | "warning";
  sceneIndex: number;
  description: string;
  fix: string;
  severity: "low" | "medium" | "high";
}

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Project ID required" }, { status: 400 });
    }

    const project = await db.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { sceneNumber: "asc" } }, characters: true },
    });

    if (!project || project.scenes.length < 2) {
      return NextResponse.json({
        success: true,
        issues: [],
        message: "Need at least 2 scenes to check continuity",
        score: 100,
      });
    }

    const zai = await ZAI.create();

    // Build a structured scene summary for the AI to analyze
    const sceneSummary = project.scenes.map((s, i) => ({
      index: i,
      title: s.title || `Scene ${i + 1}`,
      prompt: s.prompt,
      visual: s.visualNote || "",
      dialogue: s.dialogue || "",
      mood: s.mood || "unknown",
      camera: s.cameraMove || "default",
    }));

    const charSummary = project.characters.map((c) => ({
      name: c.name,
      description: c.description || "",
    }));

    const completion = await withRetry(
      () => zai.chat.completions.create({
        messages: [
          {
            role: "assistant",
            content: [
              "You are an expert Film Continuity Checker and Storyboard Editor.",
              "Analyze the following scenes for visual and narrative continuity issues.",
              "",
              "Check for:",
              "1. VISUAL INCONSISTENCIES: Time of day changes without reason, location jumps, color palette clashes",
              "2. CHARACTER CONTINUITY: Character appearances changing between scenes, missing characters",
              "3. NARRATIVE FLOW: Abrupt mood shifts, illogical scene progression, missing transitions",
              "4. CINEMATOGRAPHY: Repetitive camera angles, jarring camera changes, inconsistent lighting",
              "",
              "Return ONLY valid JSON (no markdown, no code fences):",
              '{"issues": [{"type": "inconsistency|suggestion|warning", "sceneIndex": 0, "description": "What the issue is", "fix": "How to fix it", "severity": "low|medium|high"}], "score": 85, "summary": "Overall assessment"}',
            ].join("\n"),
          },
          {
            role: "user",
            content: `Project: ${project.title}\nStyle: ${project.style}\n\nScenes:\n${JSON.stringify(sceneSummary, null, 2)}\n\nCharacters:\n${JSON.stringify(charSummary, null, 2)}`,
          },
        ],
        thinking: { type: "disabled" },
      }),
      "Continuity analysis"
    );

    let content = completion.choices[0]?.message?.content || "";
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    let parsed: { issues?: ContinuityIssue[]; score?: number; summary?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { issues: [], score: 85, summary: "Analysis completed but results could not be parsed" };
    }

    return NextResponse.json({
      success: true,
      issues: parsed.issues || [],
      score: parsed.score || 85,
      summary: parsed.summary || "Continuity check complete",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to check continuity:", error);
    return NextResponse.json({ success: false, error: "Continuity check failed: " + message }, { status: 500 });
  }
}
