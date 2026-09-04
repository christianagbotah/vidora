/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Centralized Pricing Engine (VERIFIED against official Z.ai pricing)
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  This is the financial heart of the application. It defines:
 *
 *  1. TOKEN COSTS — how many tokens each AI operation costs the user
 *  2. REAL COSTS  — how much each operation costs YOU in Z.ai API fees (USD)
 *  3. MARGIN      — the profit you make per operation
 *
 *  ── Official Z.ai price sheet (verified from docs.z.ai, Sep 2026) ──
 *
 *  VIDEO GENERATION (price per video):
 *    • CogVideoX-3 ........... $0.20 / video   (any duration 5s/10s, up to 4K)
 *    • vidu2-image ........... $0.20 / video   (4s, 720p)
 *    • vidu2-reference ....... $0.40 / video   (4s, 720p, 1–7 refs)
 *    • viduq1-text ........... $0.40 / video   (5s, 1080p)
 *    • viduq1-image .......... $0.40 / video   (5s, 1080p)
 *
 *  IMAGE GENERATION (price per image):
 *    • GLM-Image ............. $0.015 / image
 *    • CogView-4 ............. $0.01  / image
 *
 *  TEXT MODELS (per 1M tokens, input/output):
 *    • GLM-4.6 / GLM-4.5 ..... $0.60 / $2.20
 *    • GLM-4.5-Air ........... $0.20 / $1.10
 *    • GLM-4.5-Flash / 4.7-Flash ......... FREE
 *    • GLM-4.6V (vision) ..... $0.30 / $0.90  (GLM-4.6V-Flash: FREE)
 *
 *  AUDIO:
 *    • GLM-ASR-2512 .......... $0.03 / MTok  (≈ $0.0024 / minute)
 *    • TTS ................... not published by Z.ai; estimated ~$0.003 / call
 *
 *  Source: https://docs.z.ai/guides/overview/pricing
 *          https://docs.z.ai/guides/video/cogvideox-3
 *          https://docs.z.ai/guides/video/vidu2
 *          https://docs.z.ai/guides/video/vidu-q1
 *
 *  ── Why the numbers changed ──
 *  A real trial observed by the owner consumed ≈ $3 on the Z.ai portal:
 *  13 generated clips (6 GiannisBD + 4 + 3 retried E2E scenes) × $0.20
 *  = $2.60, plus ~$0.10 portraits (GLM-Image), ~$0.05 LLM, ~$0.10 TTS/ASR
 *  ≈ $2.85 — matching the official price sheet above.
 *  The previous table assumed $0.12/video (wrong: real price is $0.20),
 *  which meant every generated scene was sold at a LOSS. The numbers below
 *  restore a healthy ~33% gross margin on video generation.
 *
 *  ── The Business Model ──
 *
 *  • You pay Z.ai per API call (your COGS — Cost of Goods Sold)
 *  • Users pay YOU for tokens (your Revenue)
 *  • Token price is set so that revenue > Z.ai cost + your margin
 *
 *  ── Token Valuation ──
 *
 *  1 token ≈ GHS 0.50 ≈ USD 0.05  (baseline; volume discounts via package bonus)
 *
 *  ── Profit Calculation (1-minute, 6-scene video, CogVideoX-3) ──
 *
 *    User pays:  6 clips × 6 tokens + 6 images × 1 token ≈ 42 tokens ≈ $2.10
 *    Z.ai costs: 6 clips ($1.20) + 6 thumbs ($0.09) + LLM ($0.01) ≈ $1.30
 *    Gross margin: ≈ 38%
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
  | "scene_split"
  | "preview_storyboard"
  | "preview_image"
  | "purchase";

export interface OperationPricing {
  /** Tokens charged to the user */
  tokens: number;
  /** REAL cost in USD that Z.ai charges you (official price sheet) */
  costUsd: number;
  /** Human-readable label for receipts/analytics */
  label: string;
}

/**
 * Pricing table for each AI operation.
 *
 * All costUsd values are the OFFICIAL Z.ai list prices (see header).
 * Video gen charges the DEFAULT engine rate (CogVideoX-3, $0.20/clip).
 * Other engines have their own per-clip charges — see src/lib/storefront.ts
 * (ENGINE_SEEDS) and src/lib/video-models.ts (costUsd per model).
 */
export const PRICING: Record<OperationType, OperationPricing> = {
  // ── Video Generation (the main product) ──
  // Z.ai CogVideoX-3: $0.20/video (official). We charge 6 tokens ($0.30)
  // → ~33% gross margin on the clip itself.
  video_gen: {
    tokens: 6,
    costUsd: 0.2,
    label: "Video clip generation (per scene)",
  },

  // ── Image Generation (thumbnails, character art) ──
  // Z.ai GLM-Image: $0.015/image (official). We charge 1 token ($0.05)
  // → 70% gross margin.
  image_gen: {
    tokens: 1,
    costUsd: 0.015,
    label: "AI image generation",
  },

  // ── LLM operations (cheap, keep free or 1 token to encourage usage) ──
  // GLM-4.5-Air: $0.20/M in + $1.10/M out → ~2K in / 1K out ≈ $0.0015.
  // GLM-4.6 would be ~$0.003/call. Budget $0.001–0.004.
  prompt_enhance: {
    tokens: 0, // FREE — encourages users to start projects
    costUsd: 0.001,
    label: "Prompt enhancement (free)",
  },
  scene_split: {
    tokens: 1, // 1 token for script analysis
    costUsd: 0.004,
    label: "Script scene splitting",
  },
  continuity_check: {
    tokens: 1,
    costUsd: 0.005,
    label: "Continuity check",
  },
  llm: {
    tokens: 1,
    costUsd: 0.004,
    label: "General AI text generation",
  },

  // ── Audio operations ──
  // TTS: not on Z.ai's published price sheet; estimated ~$0.003 per call
  // (a 30–60s narration block). Charged per narration generation.
  tts: {
    tokens: 1, // 1 token per narration/voice block
    costUsd: 0.003,
    label: "AI narration (TTS)",
  },
  // ASR: GLM-ASR-2512, $0.03/MTok ≈ $0.0024 per minute (official).
  asr: {
    tokens: 1,
    costUsd: 0.003,
    label: "Voice transcription (ASR)",
  },

  // ── Download / Export ──
  // Generation already paid for; download is local ffmpeg processing.
  download: {
    tokens: 0, // FREE download (generation is where we charge)
    costUsd: 0,
    label: "Video download",
  },

  // ── FREE Previews (customer-acquisition cost, NOT charged to user) ──
  // These give prospects a taste of what they'll get BEFORE they buy tokens.
  // Cost is absorbed by the owner as marketing/CAC. Rate-limited per user/day.
  //   • Storyboard: LLM-only scene breakdown. ~$0.001 per call.
  //   • Image preview: ONE watermarked low-res still. ~$0.015 per call.
  preview_storyboard: {
    tokens: 0, // FREE
    costUsd: 0.001,
    label: "AI storyboard preview (free)",
  },
  preview_image: {
    tokens: 0, // FREE
    costUsd: 0.015,
    label: "Watermarked style preview (free)",
  },

  // ── Purchase (not an AI op; used for token-package crediting) ──
  purchase: {
    tokens: 0,
    costUsd: 0,
    label: "Token package purchase",
  },
};

/**
 * Daily free-preview limits per user.
 * Resets at local midnight (tracked by previewDate = YYYY-MM-DD).
 *
 * Economics: at 10 storyboards + 3 images/day = $0.01 + $0.045 ≈ $0.06
 * worst case per user per day (official Z.ai prices).
 */
export const PREVIEW_LIMITS = {
  storyboardPerDay: 10,
  imagePerDay: 3,
} as const;

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
 * Each Z.ai video clip is ~5-10 seconds; we assume 10s per scene
 * (CogVideoX-3 default duration).
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
 * Priced against REAL Z.ai costs (see header). With the default engine
 * (CogVideoX-3) one scene costs 7 tokens (6 clip + 1 thumbnail), so:
 *   • 30-sec video (3 scenes)  ≈ 23 tokens
 *   • 45–60s video (6 scenes)  ≈ 44 tokens  ← the classic birthday video
 *   • 2-min video (12 scenes)  ≈ 87 tokens
 *
 * Each package is sized to buy whole videos. Bigger packages give volume
 * discounts (lower per-token price) while keeping a healthy margin:
 * at official Z.ai prices, ~28 scenes can be generated per $1 of COGS
 * covered by $1.63 of token revenue (≈ 38% gross margin in USD terms).
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
      "One 30-second video (3 scenes)",
      "All video engines incl. CogVideoX-3",
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
    bonusPct: 10, // 50 + 5 bonus = 55 tokens
    popular: true,
    features: [
      "50 AI credits (+5 bonus)",
      "One full 45–60s video (6 scenes)",
      "HD 1080p export",
      "Background music + AI narration + character voices",
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
    bonusPct: 20, // 110 + 22 bonus = 132 tokens
    popular: false,
    features: [
      "110 AI credits (+22 bonus)",
      "Three 45–60s videos",
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
    bonusPct: 25, // 240 + 60 bonus = 300 tokens
    popular: false,
    features: [
      "240 AI credits (+60 bonus)",
      "Six 45–60s videos",
      "4K export",
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
    bonusPct: 30, // 550 + 165 bonus = 715 tokens
    popular: false,
    features: [
      "550 AI credits (+165 bonus)",
      "Sixteen 45–60s videos",
      "4K export",
      "Dedicated account manager",
      "All AI features",
      "Custom branding",
      "API access",
    ],
    effectiveTokenPriceGHS: 0.245,
  },
];

/**
 * Calculate actual tokens credited for a package (base + bonus).
 */
export function getEffectiveTokens(pkg: TokenPackage): number {
  return pkg.tokens + Math.round(pkg.tokens * pkg.bonusPct / 100);
}
