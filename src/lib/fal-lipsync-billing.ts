import {
  getCommercialPricingPolicy,
  quoteProviderCharge,
  type CommercialPricingPolicy,
  type ProviderChargeQuote,
} from "@/lib/provider-cost-billing";
import {
  FAL_TALKING_PHOTO_MODEL,
  FAL_TALKING_PHOTO_OPERATION,
} from "@/lib/fal-lipsync";

export function normalizeTalkingPhotoDurationSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Talking Photo duration must be a positive number of seconds.");
  }
  return Math.min(600, Math.max(1, Math.ceil(seconds)));
}

export async function quoteFalTalkingPhoto(opts: {
  durationSeconds: number;
  policy?: CommercialPricingPolicy;
}): Promise<ProviderChargeQuote> {
  const policy = opts.policy ?? await getCommercialPricingPolicy();
  return quoteProviderCharge({
    provider: "fal",
    model: FAL_TALKING_PHOTO_MODEL,
    operation: FAL_TALKING_PHOTO_OPERATION,
    quantity: normalizeTalkingPhotoDurationSeconds(opts.durationSeconds),
    policy,
  });
}
