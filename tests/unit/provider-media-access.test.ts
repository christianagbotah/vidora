import { describe, expect, test } from "bun:test";
import {
  createProviderMediaToken,
  toProviderFetchUrl,
  verifyProviderMediaToken,
} from "../../src/lib/provider-media-access";

describe("provider media capability", () => {
  test("signs only the exact generated path for a short-lived external fetch", () => {
    const previous = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "test-provider-media-secret-0123456789abcdef0123456789abcdef";
    try {
      const now = 1_800_000_000;
      const { exp, sig } = createProviderMediaToken("refs/portrait.png", now);
      expect(verifyProviderMediaToken("refs/portrait.png", String(exp), sig, now)).toBe(true);
      expect(verifyProviderMediaToken("refs/other.png", String(exp), sig, now)).toBe(false);
      expect(verifyProviderMediaToken("refs/portrait.png", String(exp), `${sig}x`, now)).toBe(false);
      expect(verifyProviderMediaToken("refs/portrait.png", String(exp), sig, exp + 1)).toBe(false);
    } finally {
      process.env.NEXTAUTH_SECRET = previous;
    }
  });

  test("adds a capability only to same-origin generated media", () => {
    const previous = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "test-provider-media-secret-0123456789abcdef0123456789abcdef";
    try {
      const signed = toProviderFetchUrl("/generated/refs/portrait.png", "https://vidora.example");
      expect(signed).toContain("https://vidora.example/generated/refs/portrait.png?");
      expect(signed).toContain("vpm_exp=");
      expect(signed).toContain("vpm_sig=");

      expect(toProviderFetchUrl("https://cdn.example/image.png", "https://vidora.example"))
        .toBe("https://cdn.example/image.png");
      expect(toProviderFetchUrl("/images/logo.png", "https://vidora.example"))
        .toBe("https://vidora.example/images/logo.png");
    } finally {
      process.env.NEXTAUTH_SECRET = previous;
    }
  });
});
