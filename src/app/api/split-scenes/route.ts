import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

const CLIP_DURATION = 10; // each video clip is 10 seconds

// Try to extract pre-defined scenes from the prompt (e.g. "Scene 1 – ...", "🎬 Scene 2: ...")
function extractDefinedScenes(prompt: string): string[] | null {
  const scenePatterns = [
    /(?:Scene\s*\d+[\s\-–—:]+)([\s\S]*?)(?=(?:Scene\s*\d+[\s\-–—:]|Final\s*Screen|\n\n\n|$))/gi,
    /(?:🎬\s*Scene\s*\d+[\s\-–—:]+)([\s\S]*?)(?=(?:🎬\s*Scene\s*\d+[\s\-–—:]|Final\s*Screen|\n\n\n|$))/gi,
  ];

  for (const pattern of scenePatterns) {
    const matches = prompt.match(pattern);
    if (matches && matches.length >= 2) {
      const scenes = matches.map((m) => {
        let cleaned = m.trim();
        cleaned = cleaned.replace(/^(?:🎬\s*)?Scene\s*\d+[\s\-–—:]+.*/im, '');
        return cleaned.trim();
      }).filter((s) => s.length > 20);

      if (scenes.length >= 2) return scenes;
    }
  }

  // Try numbered list like "1." or "1)"
  const numberedPattern = /(?:^|\n)\s*(?:🎬)?\s*\d+[.)][\s]+([\s\S]*?)(?=(?:^|\n)\s*(?:🎬)?\s*\d+[.)]|$)/gi;
  const numberedMatches = [...prompt.matchAll(numberedPattern)];
  if (numberedMatches.length >= 2) {
    const scenes = numberedMatches.map((m) => m[1].trim()).filter((s) => s.length > 20);
    if (scenes.length >= 2) return scenes;
  }

  return null;
}

// Strip dialogue, keep only visual descriptions
function extractVisualDescription(text: string): string {
  const lines = text.split('\n');
  const visualLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[A-Z][a-zA-Z\s]+:\s*["\u201C]/.test(trimmed)) continue;
    if (/^[A-Z][a-zA-Z\s]+\s*["\u201C]/.test(trimmed)) continue;
    if (/^Narrator:\s*["\u201C]/.test(trimmed)) continue;
    if (/^Everyone\s/.test(trimmed) && /:["\u201C]/.test(trimmed)) continue;
    if (/^[🎵\u{1F3B5}]/.test(trimmed)) continue;
    if (/^\u{1F3B5}/.test(trimmed)) continue;
    if (/^Final\s+Screen/i.test(trimmed)) continue;

    if (/^Visual:/i.test(trimmed)) {
      const visual = trimmed.replace(/^Visual:\s*/i, '');
      if (visual.length > 10) visualLines.push(visual);
    } else if (
      !trimmed.endsWith('"') &&
      !trimmed.endsWith('\u201D') &&
      !trimmed.endsWith('!\u201D') &&
      !/^[A-Z][a-z]+\s*[:"\u201C]/.test(trimmed) &&
      !/^Everyone\s+(shouts|sings|laughs|cheers)/i.test(trimmed)
    ) {
      if (trimmed.length > 10) visualLines.push(trimmed);
    }
  }

  return visualLines.join(' ').trim();
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, targetDuration = 60 } = await req.json();
    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    const targetSec = Math.max(10, Math.min(300, targetDuration));
    const desiredSceneCount = Math.max(1, Math.ceil(targetSec / CLIP_DURATION));

    // Step 1: Try to extract pre-defined scenes from the prompt
    const predefinedScenes = extractDefinedScenes(prompt);

    let sceneDescriptions: string[] = [];

    if (predefinedScenes && predefinedScenes.length >= 2) {
      sceneDescriptions = predefinedScenes.map((scene) => {
        const visual = extractVisualDescription(scene);
        return visual || scene.replace(/\n{2,}/g, ' ').trim();
      }).filter((s) => s.length > 20);

      if (sceneDescriptions.length > 0) {
        console.log('Extracted ' + sceneDescriptions.length + ' pre-defined scenes from prompt');
        return NextResponse.json({
          success: true,
          scenes: sceneDescriptions,
          isSingle: sceneDescriptions.length === 1,
          count: sceneDescriptions.length,
          estimatedDuration: sceneDescriptions.length * CLIP_DURATION,
          source: 'predefined',
        });
      }
    }

    // Step 2: No pre-defined scenes found — use AI to split
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: [
            'You are a film storyboard assistant. The user will give you a video concept, story, or script.',
            'Your job is to break it into EXACTLY ' + desiredSceneCount + ' individual scenes for AI video generation.',
            '',
            'Rules:',
            '- Each scene must be a self-contained visual description (NO dialogue, NO text overlays, NO on-screen text)',
            '- Each scene should represent roughly 10 seconds of video action',
            '- Scenes should flow narratively with a beginning, middle, and end',
            '- Each scene prompt should be cinematic, detailed, and 2-4 sentences describing ONLY what is visually happening',
            '- Include camera movement suggestions (pan, zoom, tracking shot, etc.)',
            '- Maintain visual continuity (same characters, settings, color palette) across scenes',
            '- You MUST return EXACTLY ' + desiredSceneCount + ' scenes — no more, no less',
            '- If the original prompt is very short, expand it creatively into ' + desiredSceneCount + ' connected moments',
            '- Do NOT add any explanation, just return the JSON',
            '',
            'Respond ONLY with valid JSON in this exact format (no markdown, no code fences):',
            '{"scenes": [{"prompt": "detailed cinematic visual scene description 1"}, {"prompt": "detailed cinematic visual scene description 2"}]}'
          ].join('\n'),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      thinking: { type: 'disabled' },
    });

    let content = completion.choices[0]?.message?.content || '';
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const parsed = JSON.parse(content);
    let scenes: string[] = parsed.scenes?.map((s: { prompt?: string; text?: string; description?: string }) =>
      s.prompt || s.text || s.description || ''
    ).filter((p: string) => p.length > 0) || [];

    // Fallback: if AI returned fewer, pad with variations
    while (scenes.length < desiredSceneCount && scenes.length > 0) {
      const lastIdx = scenes.length - 1;
      scenes.push(scenes[lastIdx] + ' (continuation, slightly different angle)');
    }

    if (scenes.length === 0) {
      return NextResponse.json({ success: true, scenes: [prompt], isSingle: true, fallback: true });
    }

    scenes = scenes.slice(0, desiredSceneCount);

    return NextResponse.json({
      success: true,
      scenes,
      isSingle: scenes.length === 1,
      count: scenes.length,
      estimatedDuration: scenes.length * CLIP_DURATION,
      source: 'ai',
    });
  } catch (error) {
    console.error('Failed to split scenes:', error);
    const body = await req.clone().json().catch(() => null);
    if (body?.prompt) {
      return NextResponse.json({ success: true, scenes: [body.prompt], isSingle: true, fallback: true });
    }
    return NextResponse.json({ success: false, error: 'Failed to analyze prompt' }, { status: 500 });
  }
}
