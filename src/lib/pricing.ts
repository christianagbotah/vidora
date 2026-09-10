/**
 * Vidora legacy/display pricing helpers.
 *
 * IMPORTANT: Billing v2's authoritative paid price is produced by
 * provider-cost-billing.ts + the persisted ProviderPrice catalog and is shown
 * in the project cost-confirmation flow immediately before generation. The
 * constants below remain for storefront planning estimates and older UI
 * surfaces only; paid provider execution must never debit from this table.
 */

export type OperationType =
  | "video_gen"
  | "image_gen"
  | "llm"
  | "tts"
  | "asr"
  | "download"
  | "continuity_check"
  | "prompt_enhance"
  | "scene_split"
  | "preview_storyboard"
  | "preview_image"
  | "purchase";

export interface OperationPricing {
  /** Planning-only credits; authoritative paid quotes are dynamic. */
  tokens: number;
  /** Approximate/default provider COGS used only for planning displays. */
  costUsd: number;
  label: string;
}

/**
 * Planning assumptions for the default CogVideoX-3 path under Billing v2.
 * With the default commercial policy, a $0.20 CogVideoX-3 request rounds to
 * 8 five-cent Vidora credits, and a generated thumbnail rounds to 1 credit.
 * Qwen narration is actually billed per character; 1 credit per typical scene
 * narration chunk is used here only as a storefront estimate.
 */
export const PRICING: Record<OperationType, OperationPricing> = {
  video_gen: {
    tokens: 8,
    costUsd: 0.2,
    label: "Video clip generation (default-engine estimate)",
  },
  image_gen: {
    tokens: 1,
    costUsd: 0.015,
    label: "AI image generation",
  },
  prompt_enhance: {
    tokens: 0,
    costUsd: 0.001,
    label: "Prompt enhancement (free/CAC when enabled)",
  },
  scene_split: {
    tokens: 1,
    costUsd: 0.004,
    label: "Script scene splitting estimate",
  },
  continuity_check: {
    tokens: 1,
    costUsd: 0.005,
    label: "Continuity check estimate",
  },
  llm: {
    tokens: 1,
    costUsd: 0.004,
    label: "General AI text estimate",
  },
  tts: {
    tokens: 1,
    // Qwen Billing v2 is per character; this is an approximate 1k-character
    // planning block, not an executable provider price.
    costUsd: 0.0115,
    label: "AI narration (typical scene estimate)",
  },
  asr: {
    tokens: 1,
    costUsd: 0.0024,
    label: "Voice transcription (about one minute)",
  },
  download: {
    tokens: 0,
    costUsd: 0,
    label: "Video download",
  },
  preview_storyboard: {
    tokens: 0,
    costUsd: 0.001,
    label: "AI storyboard preview (free/CAC)",
  },
  preview_image: {
    tokens: 0,
    costUsd: 0.015,
    label: "Watermarked style preview (free/CAC)",
  },
  purchase: {
    tokens: 0,
    costUsd: 0,
    label: "Credit package purchase",
  },
};

export const PREVIEW_LIMITS = {
  storyboardPerDay: 10,
  imagePerDay: 3,
} as const;

export interface ProjectCostBreakdown {
  scenes: { tokens: number; costUsd: number };
  narration: { tokens: number; costUsd: number };
  continuity: { tokens: number; costUsd: number };
  scriptAnalysis: { tokens: number; costUsd: number };
  totalTokens: number;
  totalCostUsd: number;
  estimatedRevenueUsd: number;
  estimatedProfitUsd: number;
  estimatedMarginPct: number;
}

/**
 * Non-binding storefront estimate for the default engine. Narration is
 * estimated per scene because Billing v2 creates per-scene/per-chunk Qwen
 * lines. The real quote may be higher or lower depending on selected model,
 * reference-image mode, actual narration text, and metered AI usage.
 */
export function calculateProjectCost(
  sceneCount: number,
  opts: { withNarration?: boolean; withContinuityCheck?: boolean; withScriptAnalysis?: boolean } = {},
): ProjectCostBreakdown {
  const count = Math.max(0, Math.floor(Number(sceneCount) || 0));
  const withNarration = opts.withNarration ?? true;
  const withContinuityCheck = opts.withContinuityCheck ?? false;
  const withScriptAnalysis = opts.withScriptAnalysis ?? false;

  const scenesTokens = count * (PRICING.video_gen.tokens + PRICING.image_gen.tokens);
  const scenesCostUsd = count * (PRICING.video_gen.costUsd + PRICING.image_gen.costUsd);

  const narrationTokens = withNarration ? count * PRICING.tts.tokens : 0;
  const narrationCostUsd = withNarration ? count * PRICING.tts.costUsd : 0;

  const continuityTokens = withContinuityCheck ? PRICING.continuity_check.tokens : 0;
  const continuityCostUsd = withContinuityCheck ? PRICING.continuity_check.costUsd : 0;

  const scriptTokens = withScriptAnalysis ? PRICING.scene_split.tokens : 0;
  const scriptCostUsd = withScriptAnalysis ? PRICING.scene_split.costUsd : 0;

  const totalTokens = scenesTokens + narrationTokens + continuityTokens + scriptTokens;
  const totalCostUsd = scenesCostUsd + narrationCostUsd + continuityCostUsd + scriptCostUsd;
  const estimatedRevenueUsd = totalTokens * TOKEN_VALUE_USD;
  const estimatedProfitUsd = estimatedRevenueUsd - totalCostUsd;
  const estimatedMarginPct = estimatedRevenueUsd > 0
    ? (estimatedProfitUsd / estimatedRevenueUsd) * 100
    : 0;

  return {
    scenes: { tokens: scenesTokens, costUsd: scenesCostUsd },
    narration: { tokens: narrationTokens, costUsd: narrationCostUsd },
    continuity: { tokens: continuityTokens, costUsd: continuityCostUsd },
    scriptAnalysis: { tokens: scriptTokens, costUsd: scriptCostUsd },
    totalTokens,
    totalCostUsd,
    estimatedRevenueUsd,
    estimatedProfitUsd,
    estimatedMarginPct,
  };
}

export function estimateSceneCount(targetDurationSeconds: number): number {
  const SCENE_DURATION_SEC = 10;
  return Math.max(1, Math.ceil(targetDurationSeconds / SCENE_DURATION_SEC));
}

/** Existing wallet denomination. GHS value in paid storefronts is derived from
 * TOKEN_VALUE_USD × the persisted billing FX rate rather than this fallback. */
export const TOKEN_VALUE_USD = 0.05;
export const TOKEN_VALUE_GHS = 0.50;

export interface TokenPackage {
  id: string;
  name: string;
  tokens: number;
  priceGHS: number;
  priceUSD: number;
  bonusPct: number;
  popular: boolean;
  features: string[];
  effectiveTokenPriceGHS: number;
}

/**
 * Legacy/default package seeds. Public Billing v2 routes revalidate every
 * active package against the current credit value and persisted GHS/USD rate;
 * an underpriced seed is hidden and cannot initialize a payment until Admin
 * repairs it. Project-count claims below are deliberately approximate.
 */
export const TOKEN_PACKAGES: TokenPackage[] = [
  {
    id: "starter",
    name: "Starter",
    tokens: 25,
    priceGHS: 12,
    priceUSD: 2.5,
    bonusPct: 0,
    popular: false,
    features: [
      "25 AI credits",
      "Up to 2 default-engine scenes with typical narration (estimate)",
      "All supported video engines",
      "Background music + AI narration",
      "Email support",
    ],
    effectiveTokenPriceGHS: 0.48,
  },
  {
    id: "basic",
    name: "Basic",
    tokens: 50,
    priceGHS: 22,
    priceUSD: 4.5,
    bonusPct: 10,
    popular: true,
    features: [
      "50 AI credits (+5 bonus)",
      "Up to 5 default-engine scenes with typical narration (estimate)",
      "HD 1080p export",
      "AI narration + character voices",
      "AI Director Mode",
      "Priority support",
    ],
    effectiveTokenPriceGHS: 0.4,
  },
  {
    id: "pro",
    name: "Pro",
    tokens: 110,
    priceGHS: 42,
    priceUSD: 8.5,
    bonusPct: 20,
    popular: false,
    features: [
      "110 AI credits (+22 bonus)",
      "About two 1-minute default-engine projects (estimate)",
      "HD 1080p export",
      "All engines incl. ViduQ1 1080p cinematic",
      "AI Director Mode + Continuity Checker",
      "Priority support",
    ],
    effectiveTokenPriceGHS: 0.32,
  },
  {
    id: "business",
    name: "Business",
    tokens: 240,
    priceGHS: 84,
    priceUSD: 17,
    bonusPct: 25,
    popular: false,
    features: [
      "240 AI credits (+60 bonus)",
      "About five 1-minute default-engine projects (estimate)",
      "4K export where supported by the selected model",
      "All AI features",
      "Dedicated support",
      "Custom branding",
    ],
    effectiveTokenPriceGHS: 0.28,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tokens: 550,
    priceGHS: 175,
    priceUSD: 35,
    bonusPct: 30,
    popular: false,
    features: [
      "550 AI credits (+165 bonus)",
      "About eleven 1-minute default-engine projects (estimate)",
      "4K export where supported by the selected model",
      "Dedicated account manager",
      "All AI features",
      "Custom branding",
      "API access",
    ],
    effectiveTokenPriceGHS: 0.245,
  },
];

export function getEffectiveTokens(pkg: TokenPackage): number {
  return pkg.tokens + Math.round(pkg.tokens * pkg.bonusPct / 100);
}
