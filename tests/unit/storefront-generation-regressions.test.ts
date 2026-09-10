import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function source(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

describe("homepage Billing v2 package storefront", () => {
  test("uses the same active credit packages and economic-floor pricing as checkout", () => {
    const route = source("src", "app", "api", "storefront", "pricing", "route.ts");

    expect(route).toContain("getActivePackages");
    expect(route).toContain("calculateSafeCreditPackageCheckoutPrice");
    expect(route).toContain("getCommercialPricingPolicy");
    expect(route).toContain("getBillingGhsPerUsd");
    expect(route).toContain('period: "one-time"');
    expect(route).toContain('ctaAction: "buy-tokens"');
    expect(route).toContain('ctaLabel: "Buy Credits"');
    expect(route).not.toContain("plans: data.plans");
  });
});

describe("single-scene regeneration billing confirmation", () => {
  test("can recover project context from the selected or persisted project", () => {
    const gate = source("src", "components", "GenerationBillingGate.tsx");

    expect(gate).toContain("state.currentProject?.id ?? state.persistedProjectId");
    expect(gate).toContain("selectedProjectIdRef.current");
    expect(gate).toContain("bodyProjectId || selectedProjectIdRef.current");
    expect(gate).toContain("/cost-quote");
    expect(gate).toContain("quoteId");
  });

  test("polls targeted regenerations faster without changing multi-scene submission behavior", () => {
    const worker = source("scripts", "generation-worker.ts");

    expect(worker).toContain("GENERATION_SINGLE_SCENE_PROVIDER_POLL_MS || 8_000");
    expect(worker).toContain("GENERATION_PROVIDER_POLL_MS || 15_000");
    expect(worker).toContain("run.targetSceneId");
    expect(worker).toContain("? SINGLE_SCENE_PROVIDER_POLL_INTERVAL_MS");
    expect(worker).toContain("intervalMs: providerPollIntervalMs");
    expect(worker).toContain("GENERATION_SUBMISSION_SPACING_MS || 15_000");
  });
});
