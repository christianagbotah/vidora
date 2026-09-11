import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function source(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

function signatureBody(route: string): string {
  const start = route.indexOf("function quoteLineSignature");
  const end = route.indexOf("export async function POST", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return route.slice(start, end);
}

describe("billing quote stability", () => {
  test("single-scene regeneration compares the billable contract instead of diagnostic USD metadata", () => {
    const route = source("src", "app", "api", "generate-video-scene", "route.ts");
    const signature = signatureBody(route);

    for (const field of [
      "lineKey",
      "provider",
      "model",
      "operation",
      "billingUnit",
      "quantity",
      "credits",
      "pricingVersion",
    ]) {
      expect(signature).toContain(`${field}: line.${field}`);
    }

    expect(signature).not.toContain("providerCostUsd");
    expect(signature).not.toContain("bufferedCostUsd");
    expect(signature).not.toContain("customerValueUsd");
    expect(signature).not.toContain("verifiedAt");
  });

  test("single-scene and project generation use the same quote compatibility fields", () => {
    const sceneSignature = signatureBody(source("src", "app", "api", "generate-video-scene", "route.ts"));
    const projectSignature = signatureBody(source("src", "app", "api", "generate-video", "route.ts"));

    const fields = [
      "lineKey",
      "provider",
      "model",
      "operation",
      "billingUnit",
      "quantity",
      "credits",
      "pricingVersion",
    ];
    for (const field of fields) {
      expect(sceneSignature.includes(`${field}: line.${field}`)).toBe(
        projectSignature.includes(`${field}: line.${field}`),
      );
    }
  });
});

describe("generation cost GHS display", () => {
  test("quote API exposes persisted-FX GHS equivalents", () => {
    const route = source("src", "app", "api", "projects", "[id]", "cost-quote", "route.ts");
    expect(route).toContain("getBillingGhsPerUsd");
    expect(route).toContain("customerValueGhs");
    expect(route).toContain("ghsPerUsd");
  });

  test("dialog displays GHS and keeps the credit amount inside the scroll area", () => {
    const dialog = source("src", "components", "GenerationCostDialog.tsx");
    expect(dialog).toContain("GH₵");
    expect(dialog).toContain("overflow-x-hidden");
    expect(dialog).toContain('className="shrink-0 pr-1 text-right"');
    expect(dialog).toContain("customerValueGhs");
  });
});
