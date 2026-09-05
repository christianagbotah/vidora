import { describe, expect, test } from "bun:test";
import { clientSceneVideoUrl, withClientSceneVideoUrl } from "@/lib/client-video-url";

describe("client scene video URLs", () => {
  test("rewrites remote provider videos to the authenticated same-origin proxy", () => {
    expect(clientSceneVideoUrl("scene 1", "https://mfile.z.ai/video.mp4?x=1")).toBe(
      "/api/scenes/scene%201/video",
    );
  });

  test("preserves Vidora-local generated URLs", () => {
    expect(clientSceneVideoUrl("scene-1", "/generated/provider-videos/scene-1.mp4")).toBe(
      "/generated/provider-videos/scene-1.mp4",
    );
  });

  test("maps complete scene objects without mutating unrelated fields", () => {
    const scene = withClientSceneVideoUrl({
      id: "abc",
      videoUrl: "https://mfile.z.ai/legacy.mp4",
      sceneNumber: 2,
    });
    expect(scene.videoUrl).toBe("/api/scenes/abc/video");
    expect(scene.sceneNumber).toBe(2);
  });
});
