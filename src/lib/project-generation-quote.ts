import { db } from "@/lib/db";
import { resolveModelForRequest } from "@/lib/video-models";
import { getAIProviderSettings } from "@/lib/ai-provider-router-qwen";
import { resolveQwenTtsModel } from "@/lib/qwen-tts";
import { stripSpeakerAttributions } from "@/lib/narration";
import {
  BillingSafetyError,
  getCommercialPricingPolicy,
  quoteProviderCharge,
  type CommercialPricingPolicy,
} from "@/lib/provider-cost-billing";
import {
  createBillingQuote,
  getWalletSummary,
  type BillingQuoteLine,
  type PersistedBillingQuote,
  type WalletSummary,
} from "@/lib/credit-reservations";

interface QuoteProjectScene {
  id: string;
  sceneNumber: number;
  referenceImageUrl: string | null;
  characterIds: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  dialogue: string | null;
  narrationUrl: string | null;
}

function hasProviderReference(
  scene: Pick<QuoteProjectScene, "referenceImageUrl" | "characterIds">,
  characters: Array<{ id: string; imageUrl: string | null }>,
): boolean {
  if (scene.referenceImageUrl && !scene.referenceImageUrl.startsWith("data:")) return true;
  if (!scene.characterIds) return false;
  try {
    const parsed: unknown = JSON.parse(scene.characterIds);
    if (!Array.isArray(parsed)) return false;
    const ids = new Set(parsed.filter((id): id is string => typeof id === "string"));
    return characters.some((character) =>
      ids.has(character.id) && Boolean(character.imageUrl) && !character.imageUrl!.startsWith("data:"),
    );
  } catch {
    return false;
  }
}

function line(label: string, lineKey: string, sceneId: string, charge: Awaited<ReturnType<typeof quoteProviderCharge>>): BillingQuoteLine {
  return { ...charge, label, lineKey, sceneId };
}

export async function buildProjectGenerationQuoteLines(opts: {
  projectId: string;
  userId: string;
  policy?: CommercialPricingPolicy;
}): Promise<{ lines: BillingQuoteLine[]; policy: CommercialPricingPolicy; sceneCount: number }> {
  const project = await db.videoProject.findUnique({
    where: { id: opts.projectId },
    include: {
      scenes: { orderBy: { sceneNumber: "asc" } },
      characters: { select: { id: true, imageUrl: true } },
    },
  });
  if (!project || !project.userId || project.userId !== opts.userId) {
    throw new Error("Project not found or not owned by the current user");
  }

  const policy = opts.policy ?? await getCommercialPricingPolicy();
  const pendingScenes = project.scenes.filter((scene) => !scene.videoUrl);
  if (pendingScenes.length === 0) {
    throw new BillingSafetyError("NOTHING_TO_GENERATE", "Every scene already has a generated video.");
  }

  const lines: BillingQuoteLine[] = [];
  for (const scene of pendingScenes) {
    const model = resolveModelForRequest(project.videoModel, hasProviderReference(scene, project.characters));
    const videoCharge = await quoteProviderCharge({
      provider: "zai",
      model,
      operation: "video_generation",
      quantity: 1,
      policy,
    });
    lines.push(line(
      `Scene ${scene.sceneNumber} video`,
      `video:${scene.id}`,
      scene.id,
      videoCharge,
    ));

    if (!scene.imageUrl) {
      const imageCharge = await quoteProviderCharge({
        provider: "zai",
        model: "glm-image",
        operation: "image_generation",
        quantity: 1,
        policy,
      });
      lines.push(line(
        `Scene ${scene.sceneNumber} thumbnail`,
        `thumbnail:${scene.id}`,
        scene.id,
        imageCharge,
      ));
    }
  }

  // Automatic narration runs after a scene video completes. Reserve its COGS
  // now so a user cannot fund the video call while leaving Vidora exposed to
  // unfunded Qwen speech calls moments later.
  const narrationScenes = pendingScenes.filter((scene) =>
    !scene.narrationUrl && Boolean(scene.dialogue?.trim()),
  );
  if (narrationScenes.length > 0) {
    const providerSettings = await getAIProviderSettings();
    if (providerSettings.ttsProvider !== "qwen") {
      throw new BillingSafetyError(
        "UNPRICED_TTS_PROVIDER",
        `Automatic narration is configured for ${providerSettings.ttsProvider}; only Qwen TTS has a verified cost catalog in this release.`,
      );
    }
    const qwenModel = resolveQwenTtsModel(providerSettings.ttsModel);
    for (const scene of narrationScenes) {
      // Speaker labels are not sent as speech. Quoting the cleaned spoken text
      // keeps the reservation aligned to Qwen's character-based billing unit.
      const spoken = stripSpeakerAttributions(scene.dialogue || "");
      const quantity = Math.max(1, spoken.length);
      const ttsCharge = await quoteProviderCharge({
        provider: "qwen",
        model: qwenModel,
        operation: "tts",
        quantity,
        policy,
      });
      lines.push(line(
        `Scene ${scene.sceneNumber} Qwen narration (${quantity} chars)`,
        `tts:${scene.id}`,
        scene.id,
        ttsCharge,
      ));
    }
  }

  return { lines, policy, sceneCount: pendingScenes.length };
}

export async function createProjectGenerationQuote(opts: {
  projectId: string;
  userId: string;
}): Promise<{
  quote: PersistedBillingQuote;
  wallet: WalletSummary;
  sceneCount: number;
}> {
  const { lines, policy, sceneCount } = await buildProjectGenerationQuoteLines(opts);
  const quote = await createBillingQuote({
    userId: opts.userId,
    projectId: opts.projectId,
    operation: "project_generation",
    lines,
    policy,
  });
  return {
    quote,
    wallet: await getWalletSummary(opts.userId),
    sceneCount,
  };
}
