import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { zai, cleanLLMOutput } from "@/lib/zai";
import { zaiErrorResponse } from "@/lib/zai-errors";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * AI Scene Continuity Checker — Analyzes all scenes in a project for visual consistency,
 * identifies contradictions (e.g., day → night without transition), and suggests fixes.
 * This is a groundbreaking feature: AI-powered storyboarding quality assurance.
 */

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

    const systemPrompt = [
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
    ].join("\n");

    const userPrompt = `Project: ${project.title}\nStyle: ${project.style}\n\nScenes:\n${JSON.stringify(sceneSummary, null, 2)}\n\nCharacters:\n${JSON.stringify(charSummary, null, 2)}`;

    const raw = await zai.chat({
      systemPrompt,
      userPrompt,
      thinking: "disabled",
      retry: { label: "Continuity analysis", timeoutMs: 60_000, maxRetries: 3 },
    });

    const content = cleanLLMOutput(raw);

    let parsed: { issues?: ContinuityIssue[]; score?: number; summary?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      // Don't swallow — surface the parse failure to the client so they know the AI returned bad JSON
      return NextResponse.json({
        success: false,
        error: "The AI returned a response that could not be parsed as JSON. Please try again.",
        rawPreview: content.slice(0, 500),
      }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      issues: parsed.issues || [],
      score: parsed.score ?? 85,
      summary: parsed.summary || "Continuity check complete",
    });
  } catch (error) {
    const session = await getServerSession(authOptions).catch(() => null);
    return zaiErrorResponse(error, {
      session,
      logLabel: "check-continuity",
    });
  }
}
