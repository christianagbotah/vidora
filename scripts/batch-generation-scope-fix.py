from pathlib import Path


def replace_exact(text: str, old: str, new: str, *, label: str, expected: int = 1) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} match(es), found {count}")
    return text.replace(old, new, expected)


# Prisma: persist the exact scene set owned by every generation run.
schema_path = Path("prisma/schema.prisma")
schema = schema_path.read_text(encoding="utf-8")
schema = replace_exact(
    schema,
    '''  userId               String
  targetSceneId        String?
  activeKey            String?      @unique''',
    '''  userId               String
  targetSceneId        String?
  sceneIds             String       @default("[]") @db.Text
  activeKey            String?      @unique''',
    label="GenerationRun sceneIds",
)
schema_path.write_text(schema, encoding="utf-8")

# Batch route: charge the same resolved engine the worker uses, only charge a
# thumbnail when one is missing, and persist exact run scene IDs.
route_path = Path("src/app/api/generate-video/route.ts")
route = route_path.read_text(encoding="utf-8")
route = replace_exact(
    route,
    'import { getEngineChargeInfo } from "@/lib/storefront";\n',
    'import { getEngineChargeInfo } from "@/lib/storefront";\nimport { resolveModelForRequest } from "@/lib/video-models";\n',
    label="batch resolveModel import",
)
route = replace_exact(
    route,
    '''export const runtime = "nodejs";

export async function POST(req: NextRequest) {''',
    '''export const runtime = "nodejs";

function hasProviderReference(
  scene: { referenceImageUrl: string | null; characterIds: string | null },
  characters: Array<{ id: string; imageUrl: string | null }>
): boolean {
  if (scene.referenceImageUrl && !scene.referenceImageUrl.startsWith("data:")) {
    return true;
  }
  if (!scene.characterIds) return false;
  try {
    const parsed: unknown = JSON.parse(scene.characterIds);
    if (!Array.isArray(parsed)) return false;
    const ids = new Set(parsed.filter((id): id is string => typeof id === "string"));
    return characters.some(
      (character) =>
        ids.has(character.id) &&
        Boolean(character.imageUrl) &&
        !character.imageUrl!.startsWith("data:")
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {''',
    label="batch provider-reference helper",
)
route = replace_exact(
    route,
    '''    const engineCharge = await getEngineChargeInfo(project.videoModel);
    const tokensPerScene = engineCharge.tokensPerClip + PRICING.image_gen.tokens;
    const costUsdPerScene = engineCharge.costUsdPerClip + PRICING.image_gen.costUsd;
    const totalTokensNeeded = scenesToProcess.length * tokensPerScene;
    const tokenCheck = await checkTokens(userId, totalTokensNeeded);''',
    '''    const sceneCharges = await Promise.all(
      scenesToProcess.map(async (scene) => {
        const resolvedModel = resolveModelForRequest(
          project.videoModel,
          hasProviderReference(scene, project.characters)
        );
        const engineCharge = await getEngineChargeInfo(resolvedModel);
        const needsThumbnail = !scene.imageUrl;
        return {
          sceneId: scene.id,
          model: resolvedModel,
          tokens: engineCharge.tokensPerClip + (needsThumbnail ? PRICING.image_gen.tokens : 0),
          costUsd: engineCharge.costUsdPerClip + (needsThumbnail ? PRICING.image_gen.costUsd : 0),
          needsThumbnail,
        };
      })
    );
    const totalTokensNeeded = sceneCharges.reduce((sum, charge) => sum + charge.tokens, 0);
    const totalCostUsd = sceneCharges.reduce((sum, charge) => sum + charge.costUsd, 0);
    const tokensPerScene = Math.ceil(totalTokensNeeded / scenesToProcess.length);
    const costUsdPerScene = totalCostUsd / scenesToProcess.length;
    const tokenCheck = await checkTokens(userId, totalTokensNeeded);''',
    label="batch exact provider pricing",
)
route = replace_exact(
    route,
    '''        costBreakdown: calculateProjectCost(scenesToProcess.length, { withNarration: false }),''',
    '''        costBreakdown: {
          sceneCount: scenesToProcess.length,
          thumbnailCount: sceneCharges.filter((charge) => charge.needsThumbnail).length,
          totalTokens: totalTokensNeeded,
        },''',
    label="batch exact insufficient-token breakdown",
)
route = replace_exact(
    route,
    '''          projectId,
          userId,
          activeKey,''',
    '''          projectId,
          userId,
          sceneIds: JSON.stringify(scenesToProcess.map((scene) => scene.id)),
          activeKey,''',
    label="batch persist scene IDs",
)
route = replace_exact(
    route,
    '''      customTokens: totalTokensNeeded,
      customCostUsd: scenesToProcess.length * costUsdPerScene,''',
    '''      customTokens: totalTokensNeeded,
      customCostUsd: totalCostUsd,''',
    label="batch exact total COGS",
)
route = route.replace('import { PRICING, calculateProjectCost } from "@/lib/pricing";', 'import { PRICING } from "@/lib/pricing";')
route_path.write_text(route, encoding="utf-8")

# Single-scene route also persists sceneIds so the worker has one canonical
# scope mechanism for new runs.
single_path = Path("src/app/api/generate-video-scene/route.ts")
single = single_path.read_text(encoding="utf-8")
single = replace_exact(
    single,
    '''          userId,
          targetSceneId: sceneId,
          activeKey,''',
    '''          userId,
          targetSceneId: sceneId,
          sceneIds: JSON.stringify([sceneId]),
          activeKey,''',
    label="single persist scene IDs",
)
single_path.write_text(single, encoding="utf-8")

# Worker: scope by persisted sceneIds first, then old targetSceneId for runs
# created before this migration, then legacy status inference only as a final
# backwards-compatible fallback.
worker_path = Path("scripts/generation-worker.ts")
worker = worker_path.read_text(encoding="utf-8")
worker = replace_exact(
    worker,
    '''  const runScenes = run.targetSceneId
    ? project.scenes.filter((scene) => scene.id === run.targetSceneId)
    : project.scenes;
  if (run.targetSceneId && runScenes.length !== 1) {
    await markReconciliation(run.id, project.id, "Generation run target scene no longer exists");
    return;
  }

  const scenes = runScenes.filter((scene) => !scene.videoUrl);''',
    '''  let persistedSceneIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(run.sceneIds || "[]");
    if (Array.isArray(parsed)) {
      persistedSceneIds = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    persistedSceneIds = [];
  }

  const requestedIds = persistedSceneIds.length > 0
    ? persistedSceneIds
    : run.targetSceneId
      ? [run.targetSceneId]
      : [];
  const requestedSet = new Set(requestedIds);
  const runScenes = requestedIds.length > 0
    ? project.scenes.filter((scene) => requestedSet.has(scene.id))
    : project.scenes.filter(
        (scene) =>
          scene.status === "queued" ||
          scene.status === "submitting" ||
          scene.status === "generating" ||
          Boolean(scene.taskId)
      );

  if (requestedIds.length > 0 && runScenes.length !== requestedSet.size) {
    await markReconciliation(run.id, project.id, "Generation run scene scope no longer matches the project");
    return;
  }

  const scenes = runScenes.filter((scene) => !scene.videoUrl);''',
    label="worker persisted scene scope",
)
worker = replace_exact(
    worker,
    '''  const scopedSceneWhere = run.targetSceneId
    ? { projectId: project.id, id: run.targetSceneId }
    : { projectId: project.id };
  const afterSubmission = await db.videoScene.findMany({
    where: scopedSceneWhere,
    orderBy: { sceneNumber: "asc" },
  });''',
    '''  const scopedSceneIds = runScenes.map((scene) => scene.id);
  const afterSubmission = await db.videoScene.findMany({
    where: { projectId: project.id, id: { in: scopedSceneIds } },
    orderBy: { sceneNumber: "asc" },
  });''',
    label="worker scoped post-submission query",
)
worker = replace_exact(
    worker,
    '''  const finalScenes = await db.videoScene.findMany({ where: scopedSceneWhere });''',
    '''  const finalScenes = await db.videoScene.findMany({
    where: { projectId: project.id, id: { in: scopedSceneIds } },
  });''',
    label="worker scoped final query",
)
worker_path.write_text(worker, encoding="utf-8")

print("Applied exact batch billing and persisted generation scene scope.")
