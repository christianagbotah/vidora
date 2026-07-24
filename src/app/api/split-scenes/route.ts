import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

const CLIP_DURATION = 10;

interface ParsedScene {
  prompt: string;
  title?: string;
  dialogue?: string;
  characterNames?: string[];
  visualNote?: string;
}

interface DetectedCharacter {
  name: string;
  role: string;
  description: string;
}

// Extract pre-defined scenes from structured scripts
function extractDefinedScenes(prompt: string): ParsedScene[] | null {
  // Pattern for "Scene 1 – Title" or "🎬 Scene 2 – Title"
  const sceneBlockPattern = /(?:🎬\s*)?(?:Scene\s*\d+)[\s\-–—:]+([^\n]*)\n([\s\S]*?)(?=(?:🎬\s*)?(?:Scene\s*\d+)[\s\-–—:]|Final\s*Screen|$)/gi;
  const matches = [...prompt.matchAll(sceneBlockPattern)];

  if (matches.length >= 2) {
    const scenes = matches.map((m) => {
      const title = m[1]?.trim() || undefined;
      const body = m[2]?.trim() || "";

      const visual = extractVisualLines(body);
      const dialogue = extractDialogue(body);
      const characters = detectCharacterNames(body);

      return {
        prompt: visual || body.replace(/\n{2,}/g, " ").trim(),
        title: title || undefined,
        dialogue: dialogue || undefined,
        characterNames: characters.length > 0 ? characters : undefined,
        visualNote: visual || undefined,
      };
    }).filter((s) => s.prompt.length > 10);

    if (scenes.length >= 2) return scenes;
  }

  // Fallback: numbered list pattern
  const numberedPattern = /(?:^|\n)\s*(?:🎬)?\s*\d+[.)][\s]+([\s\S]*?)(?=(?:^|\n)\s*(?:🎬)?\s*\d+[.)]|$)/gi;
  const numberedMatches = [...prompt.matchAll(numberedPattern)];
  if (numberedMatches.length >= 2) {
    const scenes = numberedMatches.map((m) => {
      const body = m[1].trim();
      const visual = extractVisualLines(body);
      const dialogue = extractDialogue(body);
      const characters = detectCharacterNames(body);
      return {
        prompt: visual || body.replace(/\n{2,}/g, " ").trim(),
        dialogue: dialogue || undefined,
        characterNames: characters.length > 0 ? characters : undefined,
        visualNote: visual || undefined,
      };
    }).filter((s) => s.prompt.length > 10);

    if (scenes.length >= 2) return scenes;
  }

  return null;
}

// Extract visual-only description lines from scene body
function extractVisualLines(text: string): string {
  const lines = text.split("\n");
  const visualLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip dialogue lines (CharacterName: "text")
    if (/^[A-Z][a-zA-Z\s]+:\s*["\u201C]/.test(trimmed)) continue;
    if (/^[A-Z][a-zA-Z\s]+\s*["\u201C]/.test(trimmed)) continue;
    if (/^Narrator:\s*/i.test(trimmed)) continue;
    if (/^Everyone\s/.test(trimmed) && /:["\u201C]/.test(trimmed)) continue;

    // Skip music/lyrics
    if (/^[🎵\u{1F3B5}\u{1F3B6}]/.test(trimmed)) continue;

    // Skip Final Screen
    if (/^Final\s+Screen/i.test(trimmed)) continue;

    // Extract Visual: prefixed lines
    if (/^Visual:/i.test(trimmed)) {
      const visual = trimmed.replace(/^Visual:\s*/i, "");
      if (visual.length > 10) visualLines.push(visual);
    } else if (
      !trimmed.endsWith('"') &&
      !trimmed.endsWith("\u201D") &&
      !trimmed.endsWith("!\u201D") &&
      !/^[A-Z][a-z]+\s*[:"\u201C]/.test(trimmed) &&
      !/^Everyone\s+(shouts|sings|laughs|cheers)/i.test(trimmed) &&
      trimmed.length > 10
    ) {
      visualLines.push(trimmed);
    }
  }

  return visualLines.join(" ").trim();
}

// Extract dialogue/narration from scene body
function extractDialogue(text: string): string {
  const lines = text.split("\n");
  const dialogueLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match CharacterName: "dialogue" patterns
    if (/^[A-Z][a-zA-Z\s]+:\s*["\u201C]/.test(trimmed)) {
      dialogueLines.push(trimmed);
    }
    if (/^Narrator:\s*/i.test(trimmed)) {
      dialogueLines.push(trimmed);
    }
    if (/^Everyone\s/.test(trimmed) && /:["\u201C]/.test(trimmed)) {
      dialogueLines.push(trimmed);
    }
  }

  return dialogueLines.join("\n").trim();
}

// Detect character names from dialogue attribution
function detectCharacterNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*:/gm,
    /^Narrator:/gim,
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const m of matches) {
      if (m[1] && m[1].length > 1 && m[1].length < 30) {
        names.add(m[1].trim());
      }
    }
  }

  return [...names].filter((n) => !["Visual", "Scene", "Final", "Remember"].includes(n));
}

// Detect characters across entire script with AI-enhanced descriptions
function buildCharacterDescriptions(characters: string[], fullPrompt: string): DetectedCharacter[] {
  return characters.map((name) => {
    // Try to extract description from context
    const descPattern = new RegExp(`${name}[^\\n]*?(?:"([^"]*)"[\\s\\n])`, "gi");
    const descMatch = descPattern.exec(fullPrompt);

    let role = "supporting";
    let description = `${name} character`;

    if (name.toLowerCase().includes("narrator")) {
      role = "narrator";
      description = `Narrator, off-screen voice, storytelling presence`;
    } else if (name.toLowerCase().includes("hero") || name.toLowerCase().includes("spidey") || name.toLowerCase().includes("super")) {
      role = "protagonist";
      description = `Hero character ${name}, brave and adventurous, central to the story`;
    } else {
      description = `${name}, a character in the story, colorful and expressive appearance`;
    }

    return { name, role, description };
  });
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, targetDuration = 60 } = await req.json();
    if (!prompt) {
      return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
    }

    const targetSec = Math.max(10, Math.min(300, targetDuration));
    const desiredSceneCount = Math.max(1, Math.ceil(targetSec / CLIP_DURATION));

    // Step 1: Try to extract pre-defined scenes from the prompt
    const predefinedScenes = extractDefinedScenes(prompt);

    if (predefinedScenes && predefinedScenes.length >= 2) {
      // Detect all characters across the full script
      const allCharacterNames = new Set<string>();
      for (const scene of predefinedScenes) {
        if (scene.characterNames) {
          scene.characterNames.forEach((n) => allCharacterNames.add(n));
        }
      }
      const characterList = buildCharacterDescriptions([...allCharacterNames], prompt);

      console.log(`Extracted ${predefinedScenes.length} scenes and ${characterList.length} characters from script`);
      return NextResponse.json({
        success: true,
        scenes: predefinedScenes.slice(0, desiredSceneCount),
        characters: characterList,
        count: predefinedScenes.length,
        estimatedDuration: predefinedScenes.length * CLIP_DURATION,
        source: "predefined",
      });
    }

    // Step 2: No pre-defined scenes — use AI to split and detect characters
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "assistant",
          content: [
            "You are a professional film storyboard assistant and character designer.",
            "The user will give you a video concept, story, or script.",
            "",
            "Your job is to:",
            "1. Break the concept into EXACTLY " + desiredSceneCount + " individual scenes for AI video generation",
            "2. Identify all characters mentioned in the script",
            "3. For each scene, provide visual description (NO dialogue) AND extracted dialogue",
            "",
            "Rules:",
            "- Each scene PROMPT must be a self-contained VISUAL description (NO dialogue, NO text, NO on-screen text)",
            "- Each scene should represent roughly 10 seconds of video action",
            "- Maintain visual continuity across scenes",
            "- Include camera movement suggestions in prompts",
            "- For characters: describe their visual appearance (clothing, features, age, style) for AI generation",
            "",
            "Return ONLY valid JSON (no markdown, no code fences):",
            '{"scenes": [{"prompt": "cinematic visual description", "title": "Scene Title", "dialogue": "extracted dialogue", "characterNames": ["Character1"]}], "characters": [{"name": "Character1", "role": "protagonist/supporting/narrator", "description": "visual appearance description for AI generation"}]}',
          ].join("\n"),
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      thinking: { type: "disabled" },
    });

    let content = completion.choices[0]?.message?.content || "";
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const parsed = JSON.parse(content);

    const scenes: ParsedScene[] = (parsed.scenes || []).map((s: Record<string, unknown>) => ({
      prompt: (s.prompt || s.text || s.description || "") as string,
      title: (s.title || undefined) as string | undefined,
      dialogue: (s.dialogue || undefined) as string | undefined,
      characterNames: (s.characterNames || undefined) as string[] | undefined,
      visualNote: (s.visualNote || (s.prompt || "") as string) as string | undefined,
    })).filter((s: ParsedScene) => s.prompt.length > 0);

    const characters: DetectedCharacter[] = (parsed.characters || []).map((c: Record<string, unknown>) => ({
      name: (c.name || "") as string,
      role: (c.role || "supporting") as string,
      description: (c.description || "") as string,
    })).filter((c: DetectedCharacter) => c.name.length > 0);

    // Pad if AI returned fewer scenes
    while (scenes.length < desiredSceneCount && scenes.length > 0) {
      const lastScene = scenes[scenes.length - 1];
      scenes.push({
        prompt: lastScene.prompt + " (continuation, different camera angle)",
        dialogue: lastScene.dialogue,
        characterNames: lastScene.characterNames,
      });
    }

    if (scenes.length === 0) {
      return NextResponse.json({
        success: true,
        scenes: [{ prompt }],
        characters: [],
        isSingle: true,
        fallback: true,
      });
    }

    return NextResponse.json({
      success: true,
      scenes: scenes.slice(0, desiredSceneCount),
      characters,
      count: scenes.length,
      estimatedDuration: scenes.length * CLIP_DURATION,
      source: "ai",
    });
  } catch (error) {
    console.error("Failed to split scenes:", error);
    const body = await req.clone().json().catch(() => null);
    if (body?.prompt) {
      return NextResponse.json({
        success: true,
        scenes: [{ prompt: body.prompt }],
        characters: [],
        isSingle: true,
        fallback: true,
      });
    }
    return NextResponse.json({ success: false, error: "Failed to analyze prompt" }, { status: 500 });
  }
}
