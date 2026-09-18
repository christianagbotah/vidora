import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import { estimateTextInputTokenCeiling } from "@/lib/zai-metered-billing";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), ...relative.split("/")), "utf8");
}

describe("xAI Billing v2 paid text", () => {
  test("catalog uses verified Grok 4.6 global short-context rates", () => {
    const migration = read("prisma/migrations/20260918162500_xai_grok46_text_pricing/migration.sql");
    expect(migration).toContain("'xai','grok-4.6','text_input','token',2.00");
    expect(migration).toContain("'xai','grok-4.6','text_output','token',6.00");
    expect(migration).toContain("1000000,'https://docs.x.ai/developers/pricing'");
    expect(migration).toContain("xai-grok-4.6-short-2026-09-18");
    expect(migration).toContain("Cached-input discounts are intentionally not assumed");
    expect(migration).toContain("below xAI's 200k long-context");
  });

  test("paid text preflight rejects input above its prepaid short-context ceiling", () => {
    expect(estimateTextInputTokenCeiling("hello")).toBe(5);
    expect(estimateTextInputTokenCeiling("😀")).toBe(4);
    expect(() => estimateTextInputTokenCeiling("x".repeat(128_001))).toThrow(
      "prepaid 128000-token safety ceiling",
    );
  });

  test("Billing v2 recognizes xAI and Admin Billing can re-verify its price", () => {
    const billing = read("src/lib/provider-cost-billing.ts");
    const admin = read("src/app/api/admin/billing/route.ts");
    expect(billing).toContain('BillableProvider = "zai" | "qwen" | "fal" | "xai"');
    expect(billing).toContain('value === "xai"');
    expect(admin).toContain('new Set(["zai", "qwen", "fal", "xai"])');
  });

  test("configured paid primary resolver permits only priced Z.ai/xAI routes", () => {
    const metered = read("src/lib/zai-metered-billing.ts");
    expect(metered).toContain('export type BillableTextProvider = "zai" | "xai"');
    expect(metered).toContain('if (settings.textProvider === "zai")');
    expect(metered).toContain('if (settings.textProvider === "xai")');
    expect(metered).toContain('https://api.x.ai/v1');
    expect(metered).toContain('"UNPRICED_TEXT_PROVIDER"');
    expect(metered).toContain('operation: `${route.provider}_text`');
    expect(metered).toContain("provider: route.provider");
  });

  test("strict xAI transport is exact-model single-submit with no hidden retry/fallback", () => {
    const client = read("src/lib/billed-text-provider.ts");
    expect(client).toContain('getConfigValue("xai_api_key", "XAI_API_KEY")');
    expect(client).toContain('normalizedBase !== "https://api.x.ai/v1"');
    expect(client).toContain('/chat/completions');
    expect(client).toContain("model: opts.model");
    expect(client).toContain("max_tokens: opts.maxOutputTokens");
    expect(client).toContain('reasoning_effort: "high"');
    expect(client).toContain("prompt_tokens");
    expect(client).toContain("completion_tokens");
    expect(client).toContain("provider acceptance is ambiguous");
    expect(client).not.toContain("withRetry(");
    expect(client).not.toContain("generateProviderText(");
    expect(client).not.toContain("textFallbackProvider");
  });

  test("configured-primary paid routes reserve provider-specific lines before submit and settle actual usage", () => {
    for (const relative of [
      "src/app/api/split-scenes/route.ts",
      "src/app/api/creative/long-form/plan/route.ts",
      "src/app/api/creative/long-form/episodes/[id]/expand/route.ts",
    ]) {
      const route = read(relative);
      const reserve = route.indexOf("reserveMeteredTextOperation({");
      const submit = route.indexOf("submitBilledText({");
      const capture = route.indexOf("captureActualMeteredLine({");
      const finalize = route.indexOf("finalizeMeteredReservation({");
      expect(reserve).toBeGreaterThan(-1);
      expect(submit).toBeGreaterThan(reserve);
      expect(capture).toBeGreaterThan(submit);
      expect(finalize).toBeGreaterThan(capture);
      expect(route).toContain("provider: billing.provider");
      expect(route).not.toContain("reserveMeteredZaiTextOperation({");
      expect(route).not.toContain("submitBilledZaiText({");
      expect(route).not.toContain("generateProviderText(");
    }
  });

  test("secondary/free text paths remain intentionally pinned to the verified Z.ai catalog", () => {
    for (const relative of [
      "src/app/api/enhance-scene/route.ts",
      "src/app/api/check-continuity/route.ts",
      "src/app/api/scenes/[id]/subtitles/route.ts",
      "src/app/api/scenes/[id]/dubbing/route.ts",
    ]) {
      const route = read(relative);
      expect(route).toContain("reserveMeteredZaiTextOperation");
      expect(route).toContain("submitBilledZaiText");
      expect(route).toContain("requireConfiguredPrimary: false");
    }
  });

  test("runtime deployment contract requires xAI catalog and fails closed on unpriced active text config", () => {
    const runtime = read("scripts/check-runtime-db-contract.ts");
    expect(runtime).toContain("['zai', 'xai'].includes(providerSettings.textProvider)");
    expect(runtime).toContain("'xai:grok-4.6:text_input'");
    expect(runtime).toContain("'xai:grok-4.6:text_output'");
    expect(runtime).toContain("Billing v2 xAI text pricing is verified only for https://api.x.ai/v1");
    expect(runtime).toContain('`${providerSettings.textProvider}:${configuredTextModel}:text_input`');
    expect(runtime).toContain('`${providerSettings.textProvider}:${configuredTextModel}:text_output`');
  });
});
