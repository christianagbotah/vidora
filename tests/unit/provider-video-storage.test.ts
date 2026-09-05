import { describe, expect, test } from "bun:test";
import { isTrustedProviderVideoUrl } from "@/lib/provider-video-storage";

describe("provider video storage URL policy", () => {
  test("accepts Z.AI provider media hosts", () => {
    expect(isTrustedProviderVideoUrl("https://mfile.z.ai/clip.mp4?token=abc")).toBe(true);
    expect(isTrustedProviderVideoUrl("https://cdn.z.ai/video/clip.mp4")).toBe(true);
  });

  test("rejects non-HTTPS and unrelated hosts", () => {
    expect(isTrustedProviderVideoUrl("http://mfile.z.ai/clip.mp4")).toBe(false);
    expect(isTrustedProviderVideoUrl("https://example.com/clip.mp4")).toBe(false);
    expect(isTrustedProviderVideoUrl("file:///etc/passwd")).toBe(false);
  });

  test("rejects deceptive Z.AI-looking hostnames", () => {
    expect(isTrustedProviderVideoUrl("https://mfile.z.ai.example.com/clip.mp4")).toBe(false);
    expect(isTrustedProviderVideoUrl("https://z.ai.example.net/clip.mp4")).toBe(false);
  });
});
