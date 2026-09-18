import {
  createBillingQuote,
  type BillingQuoteLine,
  type PersistedBillingQuote,
} from "@/lib/credit-reservations";
import {
  getCommercialPricingPolicy,
  type CommercialPricingPolicy,
} from "@/lib/provider-cost-billing";
import {
  FAL_TALKING_PHOTO_MODEL,
  FAL_TALKING_PHOTO_OPERATION,
} from "@/lib/fal-lipsync";
import {
  normalizeTalkingPhotoDurationSeconds,
  quoteFalTalkingPhoto,
} from "@/lib/fal-lipsync-billing";

export const TALKING_PHOTO_BILLING_OPERATION = "talking_photo";

export function talkingPhotoLineKey(imageAssetId: string, audioAssetId: string): string {
  return `talking-photo:${imageAssetId}:${audioAssetId}`;
}

export function talkingPhotoActiveKey(
  userId: string,
  imageAssetId: string,
  audioAssetId: string,
): string {
  return `talking-photo:${userId}:${imageAssetId}:${audioAssetId}`;
}

export async function createTalkingPhotoQuote(opts: {
  userId: string;
  imageAssetId: string;
  audioAssetId: string;
  durationSeconds: number;
  policy?: CommercialPricingPolicy;
}): Promise<PersistedBillingQuote> {
  const policy = opts.policy ?? await getCommercialPricingPolicy();
  const charge = await quoteFalTalkingPhoto({
    durationSeconds: opts.durationSeconds,
    policy,
  });
  const line: BillingQuoteLine = {
    ...charge,
    lineKey: talkingPhotoLineKey(opts.imageAssetId, opts.audioAssetId),
    label: "Talking Photo lip-sync",
    sceneId: null,
  };
  return createBillingQuote({
    userId: opts.userId,
    projectId: null,
    operation: TALKING_PHOTO_BILLING_OPERATION,
    lines: [line],
    policy,
  });
}

export function requireMatchingTalkingPhotoQuote(opts: {
  quote: PersistedBillingQuote;
  userId: string;
  imageAssetId: string;
  audioAssetId: string;
  durationSeconds: number;
}): BillingQuoteLine {
  const { quote } = opts;
  if (quote.userId !== opts.userId || quote.projectId !== null) {
    throw new Error("Talking Photo quote belongs to another account or context.");
  }
  if (quote.operation !== TALKING_PHOTO_BILLING_OPERATION) {
    throw new Error("Billing quote is not a Talking Photo quote.");
  }
  if (quote.status !== "open") {
    throw new Error(`Billing quote is already ${quote.status}; request a fresh quote.`);
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new Error("Billing quote expired; request a fresh quote.");
  }

  const expectedKey = talkingPhotoLineKey(opts.imageAssetId, opts.audioAssetId);
  const line = quote.breakdown.find((candidate) => candidate.lineKey === expectedKey);
  const expectedQuantity = normalizeTalkingPhotoDurationSeconds(opts.durationSeconds);
  if (
    !line ||
    line.provider !== "fal" ||
    line.model !== FAL_TALKING_PHOTO_MODEL ||
    line.operation !== FAL_TALKING_PHOTO_OPERATION ||
    line.billingUnit !== "second" ||
    line.quantity !== expectedQuantity
  ) {
    throw new Error("Talking Photo quote no longer matches the selected media or measured audio duration.");
  }
  return line;
}
