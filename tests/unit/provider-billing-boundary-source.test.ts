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
  test("every non-admin API route with a direct provider call declares a Billing v2 guard", () => {
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

  test("generation worker loads and captures immutable prepaid quote lines before media submission", () => {
    const worker = readFileSync(path.join(ROOT, "scripts", "generation-worker.ts"), "utf8");
    expect(worker).toContain("getReservedQuoteLines");
    expect(worker).toContain("requireReservedQuoteLine");
    expect(worker).toContain("captureReservedQuoteLine");
    expect(worker).toContain("model: videoLine.model");
  });

  test("shared narration binds Qwen execution to the prepaid reservation model", () => {
    const narration = readFileSync(path.join(ROOT, "src", "lib", "narration.ts"), "utf8");
    expect(narration).toContain("getReservedQuoteLines");
    expect(narration).toContain("TTS_QUOTE_QUANTITY_CHANGED");
    expect(narration).toContain("model: providerModel");
    expect(narration).toContain("TTS_EXECUTION_MODEL_DRIFT");
  });
});