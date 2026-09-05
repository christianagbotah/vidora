import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const root = process.cwd();
const generatedDir = path.join(root, "generated-store");
mkdirSync(path.join(generatedDir, "test-provider-media"), { recursive: true });

const fixture = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
writeFileSync(path.join(generatedDir, "test-provider-media", "fixture.png"), fixture);

const { toProviderFetchUrl } = await import("../../src/lib/provider-media-access");

describe("provider reference media handoff", () => {
  test("sends same-origin generated PNG bytes as base64 instead of a fetch URL", () => {
    const result = toProviderFetchUrl(
      "/generated/test-provider-media/fixture.png",
      "https://vidora.example.com"
    );
    expect(result).toBe(fixture.toString("base64"));
  });

  test("leaves third-party image URLs unchanged", () => {
    expect(
      toProviderFetchUrl(
        "https://images.example.org/reference.png",
        "https://vidora.example.com"
      )
    ).toBe("https://images.example.org/reference.png");
  });
});
