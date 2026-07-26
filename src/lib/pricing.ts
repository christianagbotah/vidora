/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Centralized Pricing Engine
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  This is the financial heart of the application. It defines:
 *
 *  1. TOKEN COSTS — how many tokens each AI operation costs the user
 *  2. REAL COSTS  — how much each operation costs YOU in Z.ai API fees (USD)
 *  3. MARGIN      — the profit you make per operation
 *
 *  ── The Business Model ──
 *
 *  • You pay Z.ai per API call (your COGS — Cost of Goods Sold)
 *  • Users pay YOU for tokens (your Revenue)
 *  • Token price is set so that revenue > Z.ai cost + your margin
 *
 *  ── Token Valuation ──
 *
 *  1 token ≈ GHS 0.50 ≈ USD 0.05  (based on Starter package: 10 tokens = GHS 5)
 *
 *  ── Profit Calculation ──
 *
 *  For a 1-minute video (6 scenes):
 *    User pays:  12 tokens × $0.05 = $0.60  (GHS 6.00)
 *    Z.ai costs: 6 clips ($0.60) + 6 images ($0.18) + LLM ($0.02) = $0.80
 *
 *  Wait — that's a LOSS. So either:
 *    (a) Raise token price, OR
 *    (b) Charge more tokens per scene, OR
 *    (c) Use cheaper Z.ai models (quality: "speed" instead of "quality")
 *
 *  This file makes the economics explicit and tunable. Adjust TOKEN_COST
 *  and ESTIMATED_COST_USD values to hit your target margin.
 * ───────────────────────────────────────────────────────────────────────────
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
  | "scene_split";

export interface OperationPricing {
  /** Tokens charged to the user */
  tokens: number;
  /** Estimated real cost in USD that Z.ai charges you */
  costUsd: number;
  /** Human-readable label for receipts/analytics */
  label: string;
}

/**
 * Pricing table for each AI operation.
 *
 * Costs are estimates based on Z.ai's typical pricing for GLM models.
 * Update these as Z.ai publishes official pricing.
 *
 * VIDEO GEN is the most expensive operation — it's the core value driver.
 */
export const PRICING: Record<OperationType, OperationPricing> = {
  // ── Video Generation (the main product) ──
  // Z.ai charges ~$0.08-0.15 per 5-10s video clip (CogVideoX)
  // We charge 3 tokens ($0.15) → ~50% margin on the video itself
  video_gen: {
    tokens: 3,
    costUsd: 0.12,
    label: "Video clip generation (per scene)",
  },

  // ── Image Generation (thumbnails, character art) ──
  // Z.ai charges ~$0.02-0.04 per image
  // We charge 1 token ($0.05) → healthy margin, bundled with video_gen
  image_gen: {
    tokens: 1,
    costUsd: 0.03,
    label: "AI image generation",
  },

  // ── LLM operations (cheap, keep free or 1 token to encourage usage) ──
  // Z.ai charges ~$0.001-0.005 per LLM call (GLM-4.5)
  prompt_enhance: {
    tokens: 0, // FREE — encourages users to start projects
    costUsd: 0.002,
    label: "Prompt enhancement (free)",
  },
  scene_split: {
    tokens: 1, // 1 token for script analysis
    costUsd: 0.003,
    label: "Script scene splitting",
  },
  continuity_check: {
    tokens: 1,
    costUsd: 0.003,
    label: "Continuity check",
  },
  llm: {
    tokens: 1,
    costUsd: 0.003,
    label: "General AI text generation",
  },

  // ── Audio operations ──
  // TTS: ~$0.002 per 1000 chars. A 1-min narration (~150 words) ≈ $0.001
  tts: {
    tokens: 1, // 1 token per ~30 seconds of narration
    costUsd: 0.002,
    label: "AI narration (TTS)",
  },
  // ASR: ~$0.002 per minute
  asr: {
    tokens: 1,
    costUsd: 0.004,
    label: "Voice transcription (ASR)",
  },

  // ── Download / Export ──
  // Generation already paid for; download is just processing cost
  download: {
    tokens: 0, // FREE download (generation is where we charge)
    costUsd: 0,
    label: "Video download",
  },
};

/**
 * Calculate the total token cost for generating a full video project.
 *
 * @param sceneCount Number of scenes to generate
 * @param withNarration Whether narration (TTS) is included
 * @param withContinuityCheck Whether continuity analysis is included
 * @returns Breakdown of token costs
 */
export interface ProjectCostBreakdown {
  scenes: { tokens: number; costUsd: number };
  narration: { tokens: number; costUsd: number };
  continuity: { tokens: number; costUsd: number };
  scriptAnalysis: { tokens: number; costUsd: number };
  totalTokens: number;
  totalCostUsd: number; // what Z.ai charges YOU
  estimatedRevenueUsd: number; // what user pays (tokens × token value)
  estimatedProfitUsd: number; // your margin
  estimatedMarginPct: number; // profit %
}

export function calculateProjectCost(
  sceneCount: number,
  opts: { withNarration?: boolean; withContinuityCheck?: boolean; withScriptAnalysis?: boolean } = {}
): ProjectCostBreakdown {
  const withNarration = opts.withNarration ?? true;
  const withContinuityCheck = opts.withContinuityCheck ?? false;
  const withScriptAnalysis = opts.withScriptAnalysis ?? false;

  // Each scene = 1 video clip + 1 thumbnail image
  const scenesTokens = sceneCount * (PRICING.video_gen.tokens + PRICING.image_gen.tokens);
  const scenesCostUsd = sceneCount * (PRICING.video_gen.costUsd + PRICING.image_gen.costUsd);

  const narrationTokens = withNarration ? PRICING.tts.tokens : 0;
  const narrationCostUsd = withNarration ? PRICING.tts.costUsd : 0;

  const continuityTokens = withContinuityCheck ? PRICING.continuity_check.tokens : 0;
  const continuityCostUsd = withContinuityCheck ? PRICING.continuity_check.costUsd : 0;

  const scriptTokens = withScriptAnalysis ? PRICING.scene_split.tokens : 0;
  const scriptCostUsd = withScriptAnalysis ? PRICING.scene_split.costUsd : 0;

  const totalTokens = scenesTokens + narrationTokens + continuityTokens + scriptTokens;
  const totalCostUsd = scenesCostUsd + narrationCostUsd + continuityCostUsd + scriptCostUsd;

  // 1 token = $0.05 (derived from Starter package: 10 tokens = $1)
  const TOKEN_VALUE_USD = 0.05;
  const estimatedRevenueUsd = totalTokens * TOKEN_VALUE_USD;
  const estimatedProfitUsd = estimatedRevenueUsd - totalCostUsd;
  const estimatedMarginPct = estimatedRevenueUsd > 0 ? (estimatedProfitUsd / estimatedRevenueUsd) * 100 : 0;

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

/**
 * Estimate scene count from target duration.
 * Each Z.ai video clip is ~5-10 seconds; we assume 10s per scene.
 */
export function estimateSceneCount(targetDurationSeconds: number): number {
  const SCENE_DURATION_SEC = 10;
  return Math.max(1, Math.ceil(targetDurationSeconds / SCENE_DURATION_SEC));
}

/**
 * Get pricing for display in the UI (packages, cost estimates).
 */
export const TOKEN_VALUE_USD = 0.05; // 1 token = $0.05
export const TOKEN_VALUE_GHS = 0.50; // 1 token = GHS 0.50

export interface TokenPackage {
  id: string;
  name: string;
  tokens: number;
  priceGHS: number;
  priceUSD: number;
  bonusPct: number; // extra tokens as bonus (e.g., 20% = 120 tokens for 100)
  popular: boolean;
  features: string[];
  // Economics for the owner
  effectiveTokenPriceGHS: number; // actual price per token (lower for bigger packages)
}

/**
 * Token packages for purchase.
 *
 * Economics: Bigger packages give volume discounts (lower per-token price),
 * but the margin remains healthy because Z.ai costs are fixed per operation.
 *
 * The "bonusPct" gives extra tokens on larger packages — a common SaaS
 * pattern that incentivizes larger upfront purchases (better cash flow for you).
 */
export const TOKEN_PACKAGES: TokenPackage[] = [
  {
    id: "starter",
    name: "Starter",
    tokens: 10,
    priceGHS: 5,
    priceUSD: 1,
    bonusPct: 0,
    popular: false,
    features: ["10 AI credits", "Standard video quality", "Email support"],
    effectiveTokenPriceGHS: 0.50,
  },
  {
    id: "basic",
    name: "Basic",
    tokens: 30,
    priceGHS: 12,
    priceUSD: 2.5,
    bonusPct: 20, // 30 + 6 bonus = 36 tokens
    popular: true,
    features: ["30 AI credits (+6 bonus)", "HD video quality", "Priority support", "AI Director Mode"],
    effectiveTokenPriceGHS: 0.33,
  },
  {
    id: "pro",
    name: "Pro",
    tokens: 75,
    priceGHS: 25,
    priceUSD: 5,
    bonusPct: 25, // 75 + ~19 bonus = 94 tokens
    popular: false,
    features: ["75 AI credits (+19 bonus)", "HD video quality", "Priority support", "AI Director Mode", "Continuity Checker"],
    effectiveTokenPriceGHS: 0.27,
  },
  {
    id: "business",
    name: "Business",
    tokens: 200,
    priceGHS: 55,
    priceUSD: 11,
    bonusPct: 30, // 200 + 60 bonus = 260 tokens
    popular: false,
    features: ["200 AI credits (+60 bonus)", "4K video quality", "Dedicated support", "All AI features", "Custom branding"],
    effectiveTokenPriceGHS: 0.21,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tokens: 500,
    priceGHS: 120,
    priceUSD: 24,
    bonusPct: 35, // 500 + 175 bonus = 675 tokens
    popular: false,
    features: ["500 AI credits (+175 bonus)", "4K video quality", "Dedicated account manager", "All AI features", "Custom branding", "API access"],
    effectiveTokenPriceGHS: 0.18,
  },
];

/**
 * Calculate actual tokens credited for a package (base + bonus).
 */
export function getEffectiveTokens(pkg: TokenPackage): number {
  return pkg.tokens + Math.round(pkg.tokens * pkg.bonusPct / 100);
}
