import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BILLING_POLICY,
  QWEN3_TTS_INSTRUCT_FLASH_USD_PER_10K_CHARACTERS,
  qwenBillableCharacterCount,
  qwenTtsCostUsd,
  quoteProviderCost,
} from "@/lib/provider-economics";

describe("provider economics", () => {
  test("CogVideoX-3 $0.20 COGS cannot be sold below the configured margin floor", () => {
    const quote = quoteProviderCost(0.2, DEFAULT_BILLING_POLICY);
    expect(quote.requiredTokens).toBe(7);
    expect(quote.minimumRevenueUsd).toBeGreaterThan(0.3);
    expect(quote.requiredTokens * quote.tokenValueUsd).toBeGreaterThanOrEqual(quote.minimumRevenueUsd);
  });

  test("$0.40 Vidu COGS has a higher protected floor", () => {
    const quote = quoteProviderCost(0.4, DEFAULT_BILLING_POLICY);
    expect(quote.requiredTokens).toBe(13);
    expect(quote.requiredTokens * quote.tokenValueUsd).toBeGreaterThanOrEqual(quote.minimumRevenueUsd);
  });

  test("free/local operations remain zero-token at the provider-cost floor", () => {
    expect(quoteProviderCost(0, DEFAULT_BILLING_POLICY).requiredTokens).toBe(0);
  });

  test("Qwen Instruct Flash uses the official per-character price", () => {
    expect(QWEN3_TTS_INSTRUCT_FLASH_USD_PER_10K_CHARACTERS).toBe(0.115);
    expect(qwenTtsCostUsd(10_000)).toBeCloseTo(0.115, 8);
    expect(qwenTtsCostUsd(500)).toBeCloseTo(0.00575, 8);
  });

  test("Qwen character quoting counts Unicode code points, not UTF-16 halves", () => {
    expect(qwenBillableCharacterCount("A🙂B")).toBe(3);
  });

  test("extreme admin percentages cannot create a non-positive pricing denominator", () => {
    const quote = quoteProviderCost(0.2, {
      tokenValueUsd: 0.05,
      targetMarginPct: 80,
      providerRiskBufferPct: 50,
      paymentFeeBufferPct: 25,
      fxBufferPct: 25,
    });
    expect(Number.isFinite(quote.minimumRevenueUsd)).toBe(true);
    expect(quote.requiredTokens).toBeGreaterThan(0);
  });
});
