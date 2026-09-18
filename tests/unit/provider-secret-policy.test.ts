import { describe, expect, test } from "bun:test";
import {
  WEB_WRITABLE_PROVIDER_SECRET_KEYS,
  normalizeWebProviderSecret,
} from "@/lib/provider-secret-policy";

describe("web-admin provider secret policy", () => {
  test("only permits approved optional execution-provider secrets", () => {
    expect(WEB_WRITABLE_PROVIDER_SECRET_KEYS.has("zai_tts_api_key")).toBe(true);
    expect(WEB_WRITABLE_PROVIDER_SECRET_KEYS.has("elevenlabs_api_key")).toBe(true);
    expect(WEB_WRITABLE_PROVIDER_SECRET_KEYS.has("fal_api_key")).toBe(true);
    expect(WEB_WRITABLE_PROVIDER_SECRET_KEYS.has("zai_api_key")).toBe(false);
    expect(WEB_WRITABLE_PROVIDER_SECRET_KEYS.has("stripe_secret_key")).toBe(false);
  });

  test("trims real keys and ignores blank input", () => {
    expect(normalizeWebProviderSecret("zai_tts_api_key", "  test-key  ")).toBe("test-key");
    expect(normalizeWebProviderSecret("zai_tts_api_key", "   ")).toBeNull();
    expect(normalizeWebProviderSecret("fal_api_key", "  fal-secret  ")).toBe("fal-secret");
  });

  test("rejects masked placeholders and unsupported secrets", () => {
    expect(() => normalizeWebProviderSecret("zai_tts_api_key", "********")).toThrow();
    expect(() => normalizeWebProviderSecret("zai_api_key", "secret")).toThrow();
  });
});
