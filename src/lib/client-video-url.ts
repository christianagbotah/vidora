export function clientSceneVideoUrl(sceneId: string, videoUrl: string | null): string | null {
  if (!videoUrl) return null;
  if (/^https?:\/\//i.test(videoUrl)) {
    return `/api/scenes/${encodeURIComponent(sceneId)}/video`;
  }
  return videoUrl;
}

export function withClientSceneVideoUrl<T extends { id: string; videoUrl: string | null }>(scene: T): T {
  return {
    ...scene,
    videoUrl: clientSceneVideoUrl(scene.id, scene.videoUrl),
  } as T;
}
