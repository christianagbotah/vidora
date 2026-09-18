import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("provider-neutral secondary text routing", () => {
  test("free text attempts quote the active verified provider without reserving customer credits", () => {
    const billing = read("src/lib/metered-text-billing.ts");
    expect(billing).toContain("export async function quoteFreeTextAttempt");
    expect(billing).toContain("resolveTextAttemptEnvelope(opts)");
    expect(billing).toContain("quoteProviderCharge({");
    expect(billing).toContain('operation: "text_input"');
    expect(billing).toContain('operation: "text_output"');
    expect(billing).not.toContain("reserveBillingQuote");
  });

  test("free/CAC endpoints quote before quota accounting and submit exactly to quoted provider/model", () => {
    for (const routePath of [
      "src/app/api/enhance-prompt/route.ts",
      "src/app/api/assistant/chat/route.ts",
      "src/app/api/preview/storyboard/route.ts",
    ]) {
      const route = read(routePath);
      const quote = route.indexOf("quoteFreeTextAttempt({");
      const submit = route.indexOf("submitBilledText({");
      expect(quote).toBeGreaterThan(0);
      expect(submit).toBeGreaterThan(quote);
      expect(route).toContain("provider: cost.provider");
      expect(route).toContain("model: cost.model");
      expect(route).toContain("customTokens: 0");
      expect(route).toContain("customCostUsd: cost.providerCostUsd");
      expect(route).not.toContain("quoteFreeZaiTextAttempt(");
      expect(route).not.toContain("zai.chat(");
    }
  });

  test("paid secondary routes preserve reserve-submit-actual-capture ordering", () => {
    for (const routePath of [
      "src/app/api/enhance-scene/route.ts",
      "src/app/api/check-continuity/route.ts",
      "src/app/api/scenes/[id]/subtitles/route.ts",
      "src/app/api/scenes/[id]/dubbing/route.ts",
    ]) {
      const route = read(routePath);
      const reserve = route.indexOf("reserveMeteredTextOperation({");
      const submit = route.indexOf("submitBilledText({");
      const capture = route.indexOf("captureActualMeteredLine({");
      expect(reserve).toBeGreaterThan(0);
      expect(submit).toBeGreaterThan(reserve);
      expect(capture).toBeGreaterThan(submit);
      expect(route).toContain("provider:");
      expect(route).not.toContain("reserveMeteredZaiTextOperation(");
      expect(route).not.toContain("submitBilledZaiText(");
      expect(route).toContain("providerBillingErrorResponse");
    }
  });

  test("paid secondary text submits using the provider/model selected by its reservation", () => {
    for (const routePath of [
      "src/app/api/enhance-scene/route.ts",
      "src/app/api/check-continuity/route.ts",
      "src/app/api/scenes/[id]/subtitles/route.ts",
    ]) {
      const route = read(routePath);
      expect(route).toContain("provider: billing.provider");
      expect(route).toContain("model: billing.model");
    }
    const dubbing = read("src/app/api/scenes/[id]/dubbing/route.ts");
    expect(dubbing).toContain("provider: translationBilling.provider");
    expect(dubbing).toContain("model: translationBilling.model");
  });

  test("dubbing keeps Qwen TTS independent from the text provider", () => {
    const route = read("src/app/api/scenes/[id]/dubbing/route.ts");
    expect(route).toContain('providerSettings.ttsProvider !== "qwen"');
    expect(route).toContain('provider: "qwen"');
    expect(route).toContain("synthesizeQwenTts");
    expect(route).toContain("Qwen TTS provider model changed after billing reservation");
  });

  test("xAI-specific safety errors have stable customer-safe mappings", () => {
    const errors = read("src/lib/billing-errors.ts");
    expect(errors).toContain('case "XAI_TEXT_CONTEXT_TOO_LARGE"');
    expect(errors).toContain('case "UNPRICED_XAI_ENDPOINT"');
    expect(errors).toContain('case "UNPRICED_XAI_MODEL"');
    expect(errors).toContain('case "XAI_KEY_MISSING"');
  });
});
