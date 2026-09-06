import { existsSync } from "fs";
import { db } from "@/lib/db";
import { resolvePublicAssetPath } from "@/lib/generated-store";
import { persistProviderVideo } from "@/lib/provider-video-storage";
import { zai } from "@/lib/zai";

export interface MaterializableSceneVideo {
  id: string;
  sceneNumber?: number | null;
  videoUrl: string | null;
  taskId?: string | null;
}

function sceneLabel(scene: MaterializableSceneVideo): string {
  return scene.sceneNumber ? `Scene ${scene.sceneNumber}` : `Scene ${scene.id}`;
}

/**
 * Resolve a scene clip to a real local filesystem path for ffmpeg.
 *
 * Same-origin generated files are used directly. Legacy provider-hosted clips
 * are archived into Vidora's generated store. If a provider URL expired, the
 * stored task id is polled once for a fresh URL before the clip is declared
 * unrecoverable. The scene row is updated to the durable same-origin URL so
 * later preview/export requests stop depending on provider cache URLs.
 */
export async function materializeSceneVideo(
  scene: MaterializableSceneVideo,
): Promise<string> {
  if (!scene.videoUrl) throw new Error(`${sceneLabel(scene)} has no generated clip`);

  if (scene.videoUrl.startsWith("/")) {
    const local = resolvePublicAssetPath(scene.videoUrl);
    if (existsSync(local)) return local;
    throw new Error(`${sceneLabel(scene)} local video file is missing`);
  }

  let providerUrl = scene.videoUrl;
  let firstError: unknown = null;
  let localUrl: string | null = null;

  try {
    localUrl = await persistProviderVideo(scene.id, providerUrl);
  } catch (error) {
    firstError = error;
  }

  if (!localUrl && scene.taskId) {
    try {
      const refreshed = await zai.pollVideoTask({
        taskId: scene.taskId,
        maxAttempts: 2,
        intervalMs: 1_500,
      });
      if (refreshed.status === "success" && refreshed.videoUrl) {
        providerUrl = refreshed.videoUrl;
        localUrl = await persistProviderVideo(scene.id, providerUrl);
      }
    } catch (refreshError) {
      console.warn(
        `[scene-video] scene=${scene.id} provider task refresh failed:`,
        refreshError instanceof Error ? refreshError.message : "unknown error",
      );
    }
  }

  if (!localUrl) {
    const detail = firstError instanceof Error ? firstError.message : "provider media unavailable";
    throw new Error(`${sceneLabel(scene)} provider video could not be recovered: ${detail}`);
  }

  const localPath = resolvePublicAssetPath(localUrl);
  if (!existsSync(localPath)) {
    throw new Error(`${sceneLabel(scene)} media copy produced no local file`);
  }

  await db.videoScene.update({
    where: { id: scene.id },
    data: { videoUrl: localUrl, errorMessage: null },
  });
  scene.videoUrl = localUrl;
  return localPath;
}
