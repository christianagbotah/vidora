from pathlib import Path
import re

path = Path("src/app/api/generate-video/route.ts")
text = path.read_text(encoding="utf-8")

replacements = {
    'import { zai, ZAIError } from "@/lib/zai";\n': '',
    'import { zaiErrorResponse, friendlySceneError } from "@/lib/zai-errors";\n': 'import { zaiErrorResponse } from "@/lib/zai-errors";\n',
    'import { saveGeneratedFile, publicOrigin, toAbsoluteUrl } from "@/lib/generated-store";\n': '',
    'import { resolveModelForRequest } from "@/lib/video-models";\n': '',
    'import { ensureReferenceAspect } from "@/lib/aspect-normalize";\n': '',
    'import { autoNarrateScene } from "@/lib/narration";\n': '',
    'import { buildSceneImagePrompt, buildSceneVideoPrompt, type CharacterLike } from "@/lib/image-prompt";\n': '',
}
for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"import assertion failed for {old!r}: found {count}")
    text = text.replace(old, new)

helper_pattern = re.compile(
    r'const VIDEO_SIZE_MAP: Record<string, string> = \{.*?\nexport async function POST\(req: NextRequest\) \{',
    re.S,
)
text, count = helper_pattern.subn('export async function POST(req: NextRequest) {', text, count=1)
if count != 1:
    raise SystemExit(f"helper block assertion failed: found {count}")

setup_block = '''    const videoSize = VIDEO_SIZE_MAP[project.aspectRatio] || "1920x1080";
    const thumbSize = THUMB_SIZE_MAP[project.aspectRatio] || "1344x768";
    const origin = publicOrigin(req);
    const genCtx = {
      style: project.style || "cinematic",
      characters: (project.characters || []) as CharacterLike[],
      aspectRatio: project.aspectRatio || "16:9",
      videoModel: project.videoModel ?? null,
    };

'''
if text.count(setup_block) != 1:
    raise SystemExit(f"web-worker setup assertion failed: found {text.count(setup_block)}")
text = text.replace(setup_block, '', 1)

background_pattern = re.compile(
    r'\n    void \(async \(\) => \{.*?\n    \}\)\(\);\n\n    return NextResponse\.json\(\{',
    re.S,
)
replacement = '''
    // Durable handoff: the PostgreSQL-backed generation worker claims this
    // GenerationRun and performs all provider submission/polling outside the
    // Next.js process. A web restart after this response cannot lose the job.

    return NextResponse.json({'''
text, count = background_pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f"background worker assertion failed: found {count}")

path.write_text(text, encoding="utf-8")
print("Batch generation route is now enqueue-only.")
