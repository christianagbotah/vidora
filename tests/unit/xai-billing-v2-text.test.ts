import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("xAI Billing v2 text foundation", () => {
  test("catalog pins official global grok-4.6 short-context prices", () => {
    const migration = read("prisma/migrations/20260918162000_xai_grok46_text_pricing/migration.sql");
    expect(migration).toContain("'xai','grok-4.6','text_input','token'");
    expect(migration).toContain("2.00,1000000");
    expect(migration).toContain("'xai','grok-4.6','text_output','token'");
    expect(migration).toContain("6.00,1000000");
    expect(migration).toContain("https://docs.x.ai/developers/models/grok-4.6");
    expect(migration).toContain("xai-grok46-global-short-2026-09-18");
  });

  test("paid xAI transport is exact-model, global-endpoint and single-submit", () => {
    const client = read("src/lib/xai-billed-client.ts");
    expect(client).toContain('XAI_GLOBAL_BASE_URL = "https://api.x.ai/v1"');
    expect(client).toContain('XAI_BILLABLE_TEXT_MODEL = "grok-4.6"');
    expect(client).toContain("UNPRICED_XAI_ENDPOINT");
    expect(client).toContain("UNPRICED_XAI_MODEL");
    expect(client).toContain('getConfigValue("xai_api_key", "XAI_API_KEY")');
    expect(client).toContain("cost_in_usd_ticks");
    expect(client).toContain("prompt_tokens");
    expect(client).toContain("completion_tokens");
    expect(client).not.toContain("withRetry(");
    expect(client).not.toContain("generateProviderText(");
  });

  test("metered route reserves before submission and blocks unverified large xAI prompts", () => {
    const billing = read("src/lib/metered-text-billing.ts");
    expect(billing).toContain('provider: "xai"');
    expect(billing).toContain("reserveImmediateProviderOperations");
    expect(billing).toContain('"text_input"');
    expect(billing).toContain('"text_output"');
    expect(billing).toContain("XAI_TEXT_CONTEXT_TOO_LARGE");
    expect(billing).toContain("promptBytes > 128_000");
    expect(billing).toContain("submitBilledXaiText(opts)");
  });

  test("runtime contract requires both static xAI prices and active route prices", () => {
    const runtime = read("scripts/check-runtime-db-contract.ts");
    expect(runtime).toContain("'xai:grok-4.6:text_input'");
    expect(runtime).toContain("'xai:grok-4.6:text_output'");
    expect(runtime).toContain("configuredTextRoute.provider");
    expect(runtime).toContain("configuredTextRoute.model");
    expect(runtime).not.toContain("configure Z.ai");
  });

  test("primary paid story routes bind provider selection to the prepaid quote", () => {
    for (const routePath of [
      "src/app/api/split-scenes/route.ts",
      "src/app/api/creative/long-form/plan/route.ts",
      "src/app/api/creative/long-form/episodes/[id]/expand/route.ts",
    ]) {
      const route = read(routePath);
      const reserve = route.indexOf("reserveMeteredTextOperation(");
      const submit = route.indexOf("submitBilledText({");
      const capture = route.indexOf("captureActualMeteredLine({");
      expect(reserve).toBeGreaterThan(0);
      expect(submit).toBeGreaterThan(reserve);
      expect(capture).toBeGreaterThan(submit);
      expect(route).toContain("provider: billing.provider");
      expect(route).toContain("model: billing.model");
      expect(route).not.toContain("submitBilledZaiText(");
    }
  });
});
