import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "src", "app", "api");

const PROVIDER_CALL_PATTERNS = [
  /\bzai\.chat\s*\(/,
  /\bzai\.vision\s*\(/,
  /\bzai\.generateImage\s*\(/,
  /\bzai\.generateVideo\s*\(/,
  /\bzai\.tts\s*\(/,
  /\bzai\.asr\s*\(/,
  /\bgenerateProviderText\s*\(/,
  /\bsynthesizeProviderSpeech\s*\(/,
  /\bsynthesizeQwenTts\s*\(/,
  /\btranscribeWithPricedZaiAsr\s*\(/,
  /\bsubmitBilledZaiText\s*\(/,
  /\bsubmitBilledZaiVision\s*\(/,
  /\bsubmitBilledZaiImage\s*\(/,
  /\bsubmitBilledZaiVideo\s*\(/,
];

const BILLING_GUARD_PATTERNS = [
  /reserveImmediateProviderOperation(?:s)?/,
  /reserveMeteredZai(?:Text|Vision|Asr)Operation/,
  /quoteFreeZaiTextAttempt/,
  /quoteProviderCharge/,
  /getReservedQuoteLines/,
  /captureReservedQuoteLine/,
];

function walkTsFiles(dir: string): string[] {
  const output: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) output.push(...walkTsFiles(full));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) output.push(full);
  }
  return output;
}

function relative(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function isOperationalProbe(file: string): boolean {
  const rel = relative(file);
  return rel.includes("/api/admin/") || rel.includes("/api/health/");
}

function directProviderCalls(source: string): string[] {
  return PROVIDER_CALL_PATTERNS
    .filter((pattern) => pattern.test(source))
    .map((pattern) => pattern.source);
}

function hasBillingGuard(source: string): boolean {
  return BILLING_GUARD_PATTERNS.some((pattern) => pattern.test(source));
}

describe("customer provider billing boundaries", () => {
  test("every non-admin API route with a provider submission declares a Billing v2 guard", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(API_ROOT)) {
      if (isOperationalProbe(file)) continue;
      const source = readFileSync(file, "utf8");
      const calls = directProviderCalls(source);
      if (calls.length === 0) continue;
      if (!hasBillingGuard(source)) {
        offenders.push(`${relative(file)} => ${calls.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("generation worker uses immutable prepaid lines and strict single-submit media transports", () => {
    const worker = readFileSync(path.join(ROOT, "scripts", "generation-worker.ts"), "utf8");
    expect(worker).toContain("getReservedQuoteLines");
    expect(worker).toContain("requireReservedQuoteLine");
    expect(worker).toContain("captureReservedQuoteLine");
    expect(worker).toContain("submitBilledZaiVideo");
    expect(worker).toContain("submitBilledZaiImage");
    expect(worker).toContain("model: videoLine.model");
    expect(worker).not.toContain("zai.generateVideo(");
    expect(worker).not.toContain("zai.generateImage(");
  });

  test("strict billed Z.ai client never exposes model fallback or paid submit retry knobs", () => {
    const client = readFileSync(path.join(ROOT, "src", "lib", "zai-billed-client.ts"), "utf8");
    expect(client).toContain("submitBilledZaiText");
    expect(client).toContain("submitBilledZaiVision");
    expect(client).toContain("submitBilledZaiImage");
    expect(client).toContain("submitBilledZaiVideo");
    expect(client).not.toContain("withRetry(");
    expect(client).not.toContain("DEFAULT_VIDEO_MODEL_ID");
  });

  test("shared narration binds Qwen execution to the prepaid reservation model", () => {
    const narration = readFileSync(path.join(ROOT, "src", "lib", "narration.ts"), "utf8");
    expect(narration).toContain("getReservedQuoteLines");
    expect(narration).toContain("TTS_QUOTE_QUANTITY_CHANGED");
    expect(narration).toContain("model: providerModel");
    expect(narration).toContain("TTS_EXECUTION_MODEL_DRIFT");
  });

  test("Billing v2 keeps the five-cent credit denomination immutable", () => {
    const route = readFileSync(path.join(ROOT, "src", "app", "api", "admin", "billing", "route.ts"), "utf8");
    const page = readFileSync(path.join(ROOT, "src", "app", "admin", "billing", "page.tsx"), "utf8");
    const policy = readFileSync(path.join(ROOT, "src", "lib", "provider-cost-billing.ts"), "utf8");
    expect(route).toContain("LOCKED_CREDIT_VALUE_USD = 0.05");
    expect(route).toContain("CREDIT_DENOMINATION_LOCKED");
    expect(route).toContain('"creditValueUsd" = ${LOCKED_CREDIT_VALUE_USD}');
    expect(page).toContain("Credit denomination");
    expect(page).not.toContain('numberField("creditValueUsd"');
    expect(policy).toContain("creditValueUsd: 0.05");
  });
});
