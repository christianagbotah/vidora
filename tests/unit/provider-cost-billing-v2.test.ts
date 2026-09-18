import { describe, expect, test } from "bun:test";
import { calculateCommercialCharge, type BillableOperation, type BillableProvider, type BillingUnit, type CommercialPricingPolicy } from "@/lib/provider-cost-billing";
import { calculateCreditPackageEconomics, calculateSafeCreditPackageCheckoutPrice } from "@/lib/package-billing-safety";
import {
  DEFAULT_ZAI_IMAGE_MODEL_ID,
  resolveZaiImageBillingModel,
  resolveZaiVideoBillingModel,
} from "@/lib/zai-billing-models";
import { estimateTextInputTokenCeiling } from "@/lib/zai-metered-billing";
import { resolveQwenTtsModel } from "@/lib/qwen-tts";
import { requireReservedQuoteLine } from "@/lib/reserved-quote";
import type { BillingQuoteLine } from "@/lib/credit-reservations";
import {
  FAL_TALKING_PHOTO_MODEL,
  FAL_TALKING_PHOTO_OPERATION,
} from "@/lib/fal-lipsync";
import { normalizeTalkingPhotoDurationSeconds } from "@/lib/fal-lipsync-billing";

const policy: CommercialPricingPolicy = {
  creditValueUsd: 0.05,
  targetGrossMarginPct: 0.35,
  providerSafetyBufferPct: 0.05,
  fxSafetyBufferPct: 0.05,
  gatewayFeeReservePct: 0.03,
  infrastructureReservePct: 0.03,
  minimumChargeCredits: 1,
  priceMaxAgeHours: 1080,
  quoteTtlMinutes: 15,
  billingEnabled: true,
};

describe("provider-cost-backed commercial pricing", () => {
  test("customer charge covers buffered COGS and configured margin", () => {
    const charge = calculateCommercialCharge(0.20, policy);
    expect(charge.credits).toBe(8);
    expect(charge.customerValueUsd).toBeGreaterThan(charge.bufferedCostUsd);
    expect(charge.estimatedGrossMarginPct).toBeGreaterThanOrEqual(policy.targetGrossMarginPct - 0.02);
  });

  test("rounds upward to whole credits instead of undercharging", () => {
    const charge = calculateCommercialCharge(0.115 / 10_000 * 563, policy);
    expect(charge.credits).toBe(Math.ceil(charge.customerPriceUsd / policy.creditValueUsd));
    expect(charge.customerValueUsd).toBeGreaterThanOrEqual(charge.customerPriceUsd);
  });

  test("unsafe margin policy fails closed", () => {
    expect(() => calculateCommercialCharge(0.20, {
      ...policy,
      targetGrossMarginPct: 0.95,
      gatewayFeeReservePct: 0.10,
    })).toThrow();
  });
});

describe("credit package economic floor", () => {
  test("bonus credits are included in minimum package value", () => {
    const economics = calculateCreditPackageEconomics({
      baseCredits: 100,
      bonusPct: 20,
      ghsPerUsd: 12.5,
      policy,
    });
    expect(economics.effectiveCredits).toBe(120);
    expect(economics.minimumPriceUsd).toBeCloseTo(6.00, 8);
    expect(economics.minimumPriceGhs).toBeCloseTo(75, 8);
  });

  test("legacy GHS package price is raised to the live floor while a safe USD price is preserved", () => {
    const safe = calculateSafeCreditPackageCheckoutPrice({
      baseCredits: 50,
      bonusPct: 10,
      configuredPriceUsd: 4.5,
      configuredPriceGhs: 22,
      ghsPerUsd: 12.5,
      policy,
    });
    expect(safe.effectiveCredits).toBe(55);
    expect(safe.checkoutPriceUsd).toBe(4.5);
    expect(safe.checkoutPriceGhs).toBe(34.38);
    expect(safe.repricedUsd).toBe(false);
    expect(safe.repricedGhs).toBe(true);
  });
});

describe("Z.ai billing model resolution", () => {
  test("image billing uses the exact transport default and preserves configured overrides", () => {
    const previous = process.env.ZAI_IMAGE_MODEL;
    try {
      delete process.env.ZAI_IMAGE_MODEL;
      expect(resolveZaiImageBillingModel()).toBe(DEFAULT_ZAI_IMAGE_MODEL_ID);
      process.env.ZAI_IMAGE_MODEL = "glm-image";
      expect(resolveZaiImageBillingModel()).toBe("glm-image");
      process.env.ZAI_IMAGE_MODEL = "unpriced-image-model";
      expect(resolveZaiImageBillingModel()).toBe("unpriced-image-model");
    } finally {
      if (previous === undefined) delete process.env.ZAI_IMAGE_MODEL;
      else process.env.ZAI_IMAGE_MODEL = previous;
    }
  });

  test("video billing keeps overrides input-compatible and falls back safely", () => {
    const previous = process.env.ZAI_VIDEO_MODEL;
    try {
      delete process.env.ZAI_VIDEO_MODEL;
      expect(resolveZaiVideoBillingModel("viduq1-text", false)).toBe("viduq1-text");
      expect(resolveZaiVideoBillingModel("vidu2-image", false)).toBe("CogVideoX-3");

      process.env.ZAI_VIDEO_MODEL = "vidu2-reference";
      expect(resolveZaiVideoBillingModel("CogVideoX-3", false)).toBe("CogVideoX-3");
      expect(resolveZaiVideoBillingModel("CogVideoX-3", true)).toBe("vidu2-reference");

      process.env.ZAI_VIDEO_MODEL = "unknown-provider-model";
      expect(resolveZaiVideoBillingModel("viduq1-text", false)).toBe("CogVideoX-3");
    } finally {
      if (previous === undefined) delete process.env.ZAI_VIDEO_MODEL;
      else process.env.ZAI_VIDEO_MODEL = previous;
    }
  });
});

describe("metered provider safeguards", () => {
  test("text token preflight uses a conservative UTF-8 byte ceiling", () => {
    expect(estimateTextInputTokenCeiling("abc")).toBe(3);
    expect(estimateTextInputTokenCeiling("😀")).toBe(4);
    expect(estimateTextInputTokenCeiling("x".repeat(200_000))).toBe(128_000);
  });

  test("legacy Qwen flash configuration resolves to the priced instruction model", () => {
    expect(resolveQwenTtsModel("qwen3-tts-flash")).toBe("qwen3-tts-instruct-flash");
    expect(resolveQwenTtsModel("qwen3-tts-instruct-flash")).toBe("qwen3-tts-instruct-flash");
  });

  test("reserved quote lookup requires the exact line/provider/operation", () => {
    const line = {
      lineKey: "video:scene-1",
      provider: "zai",
      model: "viduq1-text",
      operation: "video_generation",
    } as BillingQuoteLine;
    expect(requireReservedQuoteLine([line], {
      lineKey: "video:scene-1",
      provider: "zai",
      operation: "video_generation",
    }).model).toBe("viduq1-text");
    expect(() => requireReservedQuoteLine([line], {
      lineKey: "video:scene-1",
      provider: "zai",
      operation: "image_generation",
    })).toThrow();
    expect(() => requireReservedQuoteLine([line], {
      lineKey: "video:missing",
      provider: "zai",
      operation: "video_generation",
    })).toThrow();
  });
});

describe("fal Talking Photo billing foundation", () => {
  test("Billing v2 accepts fal lip-sync as a first-class provider operation", () => {
    const provider: BillableProvider = "fal";
    const operation: BillableOperation = "lip_sync";
    const unit: BillingUnit = "second";
    expect(provider).toBe("fal");
    expect(operation).toBe(FAL_TALKING_PHOTO_OPERATION);
    expect(unit).toBe("second");
    expect(FAL_TALKING_PHOTO_MODEL).toBe("fal-ai/sync-lipsync/v3/image-to-video");
  });

  test("rounds output duration up to whole billable seconds and caps unsafe input", () => {
    expect(normalizeTalkingPhotoDurationSeconds(0.1)).toBe(1);
    expect(normalizeTalkingPhotoDurationSeconds(8)).toBe(8);
    expect(normalizeTalkingPhotoDurationSeconds(8.01)).toBe(9);
    expect(normalizeTalkingPhotoDurationSeconds(900)).toBe(600);
    expect(() => normalizeTalkingPhotoDurationSeconds(0)).toThrow();
    expect(() => normalizeTalkingPhotoDurationSeconds(Number.NaN)).toThrow();
  });
});
