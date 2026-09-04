from pathlib import Path
import re


def replace_exact(text: str, old: str, new: str, *, expected: int = 1, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} exact match(es), found {count}")
    return text.replace(old, new)


# ── Prisma run scope ──────────────────────────────────────────────────────────
schema_path = Path("prisma/schema.prisma")
schema = schema_path.read_text(encoding="utf-8")
schema = replace_exact(
    schema,
    '''  userId               String
  activeKey            String?      @unique''',
    '''  userId               String
  targetSceneId        String?
  activeKey            String?      @unique''',
    label="GenerationRun target scene field",
)
schema = replace_exact(
    schema,
    '''  @@index([projectId, createdAt])
  @@index([status, updatedAt])
}''',
    '''  @@index([projectId, createdAt])
  @@index([targetSceneId])
  @@index([status, updatedAt])
}''',
    expected=1,
    label="GenerationRun target scene index",
)
schema_path.write_text(schema, encoding="utf-8")

# ── Durable worker: scope a run to one scene when targetSceneId is present ──
worker_path = Path("scripts/generation-worker.ts")
worker = worker_path.read_text(encoding="utf-8")
worker = replace_exact(
    worker,
    '''    characterIds: string | null;
  };''',
    '''    characterIds: string | null;
    duration: number;
  };''',
    label="worker submitted scene duration type",
)
worker = replace_exact(
    worker,
    '''    duration: 10,
    quality: "quality",''',
    '''    duration: Math.max(1, Math.min(30, scene.duration || 10)),
    quality: "quality",''',
    label="worker scene duration",
)
worker = replace_exact(
    worker,
    '''  const scenes = project.scenes.filter((scene) => !scene.videoUrl);
  if (scenes.length === 0) {
    await Promise.all([
      db.videoProject.update({ where: { id: project.id }, data: { status: "completed" } }),
      db.generationRun.update({
        where: { id: run.id },
        data: { status: "completed", activeKey: null, error: null },
      }),
    ]);
    return;
  }''',
    '''  const runScenes = run.targetSceneId
    ? project.scenes.filter((scene) => scene.id === run.targetSceneId)
    : project.scenes;
  if (run.targetSceneId && runScenes.length !== 1) {
    await markReconciliation(run.id, project.id, "Generation run target scene no longer exists");
    return;
  }

  const scenes = runScenes.filter((scene) => !scene.videoUrl);
  if (scenes.length === 0) {
    const incompleteProjectScenes = await db.videoScene.count({
      where: { projectId: project.id, videoUrl: null },
    });
    await Promise.all([
      db.videoProject.update({
        where: { id: project.id },
        data: { status: incompleteProjectScenes === 0 ? "completed" : "generating" },
      }),
      db.generationRun.update({
        where: { id: run.id },
        data: { status: "completed", activeKey: null, error: null },
      }),
    ]);
    return;
  }''',
    label="worker run scope",
)
worker = replace_exact(
    worker,
    '''  const afterSubmission = await db.videoScene.findMany({
    where: { projectId: project.id },
    orderBy: { sceneNumber: "asc" },
  });''',
    '''  const scopedSceneWhere = run.targetSceneId
    ? { projectId: project.id, id: run.targetSceneId }
    : { projectId: project.id };
  const afterSubmission = await db.videoScene.findMany({
    where: scopedSceneWhere,
    orderBy: { sceneNumber: "asc" },
  });''',
    label="worker after-submission scope",
)
worker = replace_exact(
    worker,
    '''  const finalScenes = await db.videoScene.findMany({ where: { projectId: project.id } });
  const allVideosDone = finalScenes.every((scene) => Boolean(scene.videoUrl));
  if (allVideosDone && !thumbnailFailure) {
    await Promise.all([
      db.videoProject.update({ where: { id: project.id }, data: { status: "completed" } }),
      db.generationRun.update({
        where: { id: run.id },
        data: { status: "completed", activeKey: null, error: null },
      }),
    ]);
    return;
  }''',
    '''  const finalScenes = await db.videoScene.findMany({ where: scopedSceneWhere });
  const allVideosDone = finalScenes.every((scene) => Boolean(scene.videoUrl));
  if (allVideosDone && !thumbnailFailure) {
    const incompleteProjectScenes = await db.videoScene.count({
      where: { projectId: project.id, videoUrl: null },
    });
    await Promise.all([
      db.videoProject.update({
        where: { id: project.id },
        data: { status: incompleteProjectScenes === 0 ? "completed" : "generating" },
      }),
      db.generationRun.update({
        where: { id: run.id },
        data: { status: "completed", activeKey: null, error: null },
      }),
    ]);
    return;
  }''',
    label="worker completion scope",
)
worker_path.write_text(worker, encoding="utf-8")

# ── Single-scene route: validate/charge/enqueue only ─────────────────────────
route_path = Path("src/app/api/generate-video-scene/route.ts")
route = route_path.read_text(encoding="utf-8")
for old in [
    'import { zai, ZAIError } from "@/lib/zai";\n',
    'import { friendlySceneError } from "@/lib/zai-errors";\n',
    'import { saveGeneratedFile,\n  publicOrigin,\n  toAbsoluteUrl,\n} from "@/lib/generated-store";\n',
    'import { ensureReferenceAspect } from "@/lib/aspect-normalize";\n',
    'import { autoNarrateScene } from "@/lib/narration";\n',
    'import {\n  buildSceneImagePrompt,\n  buildSceneVideoPrompt,\n} from "@/lib/image-prompt";\n',
]:
    if route.count(old) != 1:
        raise SystemExit(f"single-scene import assertion failed for {old!r}: found {route.count(old)}")
    route = route.replace(old, "", 1)

route, count = re.subn(
    r'''const VIDEO_SIZE_MAP: Record<string, string> = \{.*?\n\};\n\nconst THUMB_SIZE_MAP: Record<string, string> = \{.*?\n\};\n\n''',
    "",
    route,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"single-scene size constants: expected 1 block, found {count}")

route = replace_exact(
    route,
    '''    const aspectRatio = project.aspectRatio || "16:9";
    const projectStyle = project.style || null;
    const videoModel = project.videoModel ?? null;''',
    '''    const videoModel = project.videoModel ?? null;''',
    label="single-scene unused project render settings",
)
route = replace_exact(
    route,
    '''    const videoPrompt = buildSceneVideoPrompt({
      scenePrompt: prompt,
      characters: project.characters,
      linkedCharacterIds: scene.characterIds,
    });
    const imagePrompt = buildSceneImagePrompt({
      scenePrompt: prompt,
      style: projectStyle,
      characters: project.characters,
      linkedCharacterIds: scene.characterIds,
    });

''',
    "",
    label="single-scene in-request prompt building",
)
route = replace_exact(
    route,
    '''          projectId,
          userId,
          activeKey,''',
    '''          projectId,
          userId,
          targetSceneId: sceneId,
          activeKey,''',
    label="single-scene run target",
)
route = replace_exact(
    route,
    '''    await db.videoScene.update({
      where: { id: sceneId },
      data: { status: "queued", taskId: null, errorMessage: null },
    });''',
    '''    await db.videoScene.update({
      where: { id: sceneId },
      data: {
        enhancedPrompt: prompt,
        duration,
        status: "queued",
        taskId: null,
        errorMessage: null,
      },
    });''',
    label="persist single-scene worker payload",
)

route, count = re.subn(
    r'''\n    const videoSize = VIDEO_SIZE_MAP\[aspectRatio\].*?\n    \}\);\n\n    return NextResponse\.json\(\{''',
    '''

    // Durable handoff: the shared generation worker owns all provider work.
    // No video/image provider call occurs inside this Next.js request process.
    return NextResponse.json({''',
    route,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"single-scene background handoff block: expected 1, found {count}")

route, count = re.subn(
    r'''\nasync function runSceneGeneration\(opts: \{.*\Z''',
    "\n",
    route,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"single-scene legacy worker helper: expected 1, found {count}")

route_path.write_text(route, encoding="utf-8")
print("Applied durable single-scene generation scope cutover.")
