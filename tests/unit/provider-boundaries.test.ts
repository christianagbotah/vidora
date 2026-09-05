import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const PROVIDER_CALL_RE = /zai\.(chat|vision|generateImage|generateVideo|tts|asr|pollVideoTask)\s*\(/g;

const REVIEWED_BOUNDARIES: Record<string, string> = {
  "scripts/check-zai-live.ts": "production_deploy_free_live_probe",
  "scripts/generation-worker.ts": "durable_worker_paid_generation",
  "src/app/api/ai/health/route.ts": "admin_only_cached_live_probe",
  "src/app/api/analyze-video/route.ts": "authenticated_metered",
  "src/app/api/assistant/chat/route.ts": "authenticated_bounded_free_preview",
  "src/app/api/check-continuity/route.ts": "project_authorized_metered",
  "src/app/api/enhance-prompt/route.ts": "authenticated_bounded_free_preview",
  "src/app/api/enhance-scene/route.ts": "authenticated_metered",
  "src/app/api/generate-scene/route.ts": "authenticated_metered",
  "src/app/api/preview/image/route.ts": "authenticated_bounded_free_preview",
  "src/app/api/preview/storyboard/route.ts": "authenticated_bounded_free_preview",
  "src/app/api/projects/[id]/characters/[characterId]/generate-image/route.ts": "project_authorized_metered",
  "src/app/api/scenes/[id]/dubbing/route.ts": "scene_authorized_metered_idempotent",
  "src/app/api/scenes/[id]/subtitles/route.ts": "scene_authorized_metered_idempotent",
  "src/app/api/split-scenes/legacy.ts": "legacy_local_parser_with_historical_provider_fallback",
  "src/app/api/transcribe/route.ts": "authenticated_metered",
  "src/lib/ai-provider-router.ts": "central_capability_router_for_text_and_tts",
  "src/lib/zai.ts": "provider_sdk_transport_internal",
};

function walk(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) output.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) output.push(full);
  }
  return output;
}

function normalize(file: string): string {
  return file.split(path.sep).join("/");
}

describe("AI provider boundary inventory", () => {
  test("every direct Z.ai call lives in a reviewed boundary", () => {
    const roots = ["src", "scripts"].filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });

    const directCalls = new Map<string, number>();
    for (const root of roots) {
      for (const file of walk(root)) {
        const text = readFileSync(file, "utf8");
        const count = [...text.matchAll(PROVIDER_CALL_RE)].length;
        if (count > 0) directCalls.set(normalize(file), count);
      }
    }

    const unexpected = [...directCalls.keys()]
      .filter((file) => !REVIEWED_BOUNDARIES[file])
      .sort();

    expect(unexpected).toEqual([]);
  });

  test("review classifications are explicit and non-empty", () => {
    for (const [file, classification] of Object.entries(REVIEWED_BOUNDARIES)) {
      expect(file.length).toBeGreaterThan(0);
      expect(classification.length).toBeGreaterThan(0);
    }
  });
});
