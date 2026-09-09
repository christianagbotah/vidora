from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def patch(path: str, transform):
    file = Path(path)
    original = file.read_text()
    updated = transform(original)
    if updated == original:
        raise SystemExit(f"{path}: patch made no changes")
    file.write_text(updated)


def patch_pricing(text: str) -> str:
    return replace_once(
        text,
        "video_gen: {\n    tokens: 6,\n    costUsd: 0.2,",
        "video_gen: {\n    tokens: 7,\n    costUsd: 0.2,",
        "pricing CogVideo default floor",
    )


def patch_storefront(text: str) -> str:
    text = replace_once(
        text,
        'import { PRICING } from "@/lib/pricing";',
        'import { PRICING } from "@/lib/pricing";\nimport {\n  getBillingPolicy,\n  getPricingGhsPerUsd,\n  protectConfiguredTokenCharge,\n} from "@/lib/provider-economics";',
        "storefront billing import",
    )

    helper_anchor = "/** All engines with pricing (admin view — includes inactive). Cache-bypassing. */"
    helper = '''async function protectEngineEntries(entries: EnginePricingEntry[]): Promise<EnginePricingEntry[]> {\n  const [policy, ghsPerUsd] = await Promise.all([getBillingPolicy(), getPricingGhsPerUsd()]);\n  return Promise.all(entries.map(async (entry) => {\n    const protectedCharge = await protectConfiguredTokenCharge(entry.tokensPerClip, entry.zaiCostUsd);\n    const tokensPerClip = protectedCharge.tokens;\n    const floorPriceUSD = tokensPerClip * policy.tokenValueUsd;\n    const priceUSD = Math.max(entry.priceUSD, floorPriceUSD);\n    const floorPriceGHS = floorPriceUSD * ghsPerUsd * (1 + policy.fxBufferPct / 100);\n    const priceGHS = Math.max(entry.priceGHS, floorPriceGHS);\n    const marginPct = priceUSD > 0\n      ? ((priceUSD - entry.zaiCostUsd) / priceUSD) * 100\n      : 0;\n    return {\n      ...entry,\n      tokensPerClip,\n      priceUSD: Math.round(priceUSD * 100) / 100,\n      priceGHS: Math.round(priceGHS * 100) / 100,\n      marginPct: Math.round(marginPct),\n    };\n  }));\n}\n\n'''
    text = replace_once(text, helper_anchor, helper + helper_anchor, "storefront engine protector helper")

    old_admin = '''export async function getEnginePricingForAdmin(): Promise<EnginePricingEntry[]> {\n  try {\n    await seedEnginesIfEmpty();\n    const rows = await db.enginePricing.findMany();\n    const byId = new Map(rows.map((r) => [r.modelId, r]));\n    // Merge: every catalog model appears exactly once. A model with no DB row\n    // (newly added to the catalog) falls back to its seed pricing.\n    return fallbackEngines().map((entry) => {\n      const row = byId.get(entry.modelId);\n      if (!row) return entry;\n      return rowToEngineEntry({\n        modelId: row.modelId,\n        priceGHS: row.priceGHS,\n        priceUSD: row.priceUSD,\n        tokensPerClip: row.tokensPerClip,\n        isActive: row.isActive,\n      }) ?? entry;\n    });\n  } catch (err) {\n    console.error("[storefront] engine pricing read failed, using fallback:", err);\n    return fallbackEngines();\n  }\n}\n'''
    new_admin = '''export async function getEnginePricingForAdmin(): Promise<EnginePricingEntry[]> {\n  try {\n    await seedEnginesIfEmpty();\n    const rows = await db.enginePricing.findMany();\n    const byId = new Map(rows.map((r) => [r.modelId, r]));\n    // Merge: every catalog model appears exactly once. A model with no DB row\n    // (newly added to the catalog) falls back to its seed pricing.\n    const entries = fallbackEngines().map((entry) => {\n      const row = byId.get(entry.modelId);\n      if (!row) return entry;\n      return rowToEngineEntry({\n        modelId: row.modelId,\n        priceGHS: row.priceGHS,\n        priceUSD: row.priceUSD,\n        tokensPerClip: row.tokensPerClip,\n        isActive: row.isActive,\n      }) ?? entry;\n    });\n    return protectEngineEntries(entries);\n  } catch (err) {\n    console.error("[storefront] engine pricing read failed, using protected fallback:", err);\n    return protectEngineEntries(fallbackEngines());\n  }\n}\n'''
    text = replace_once(text, old_admin, new_admin, "storefront admin engine floor")

    old_charge = '''export async function getEngineChargeInfo(\n  modelId: string | null | undefined\n): Promise<{ tokensPerClip: number; costUsdPerClip: number }> {\n  // Real Z.ai COGS always comes from the verified catalog (video-models.ts)\n  // — NOT from the admin display price, which includes our margin.\n  const resolved = modelId ?? DEFAULT_VIDEO_MODEL_ID;\n  const catalogCost = getVideoModelInfo(resolved)?.costUsd ?? PRICING.video_gen.costUsd;\n  const fallback = {\n    tokensPerClip: PRICING.video_gen.tokens,\n    costUsdPerClip: catalogCost,\n  };\n  try {\n    const row = await db.enginePricing.findUnique({ where: { modelId: resolved } });\n    if (row) return { tokensPerClip: row.tokensPerClip, costUsdPerClip: catalogCost };\n  } catch (err) {\n    console.error("[storefront] engine charge lookup failed, using default:", err);\n  }\n  return fallback;\n}\n'''
    new_charge = '''export async function getEngineChargeInfo(\n  modelId: string | null | undefined\n): Promise<{ tokensPerClip: number; costUsdPerClip: number; floorTokens: number }> {\n  // Real Z.ai COGS always comes from the verified catalog (video-models.ts)\n  // — NOT from the admin display price, which includes our margin.\n  const resolved = modelId ?? DEFAULT_VIDEO_MODEL_ID;\n  const catalogCost = getVideoModelInfo(resolved)?.costUsd ?? PRICING.video_gen.costUsd;\n  let configuredTokens = PRICING.video_gen.tokens;\n  try {\n    const row = await db.enginePricing.findUnique({ where: { modelId: resolved } });\n    if (row) configuredTokens = row.tokensPerClip;\n  } catch (err) {\n    console.error("[storefront] engine charge lookup failed, using protected default:", err);\n  }\n  const protectedCharge = await protectConfiguredTokenCharge(configuredTokens, catalogCost);\n  return {\n    tokensPerClip: protectedCharge.tokens,\n    costUsdPerClip: catalogCost,\n    floorTokens: protectedCharge.floorTokens,\n  };\n}\n'''
    text = replace_once(text, old_charge, new_charge, "storefront runtime charge floor")

    old_tokens = '    const tokens = Math.max(1, Math.floor(Number(e.tokensPerClip) || 1));'
    new_tokens = '''    const modelInfo = getVideoModelInfo(e.modelId);\n    if (!modelInfo) continue;\n    const configuredTokens = Math.max(1, Math.floor(Number(e.tokensPerClip) || 1));\n    const protectedCharge = await protectConfiguredTokenCharge(configuredTokens, modelInfo.costUsd);\n    const tokens = protectedCharge.tokens;'''
    text = replace_once(text, old_tokens, new_tokens, "storefront admin save floor")
    return text


def patch_packages(text: str) -> str:
    text = replace_once(
        text,
        'import { TOKEN_PACKAGES, getEffectiveTokens, type TokenPackage } from "@/lib/pricing";',
        'import { TOKEN_PACKAGES, getEffectiveTokens, type TokenPackage } from "@/lib/pricing";\nimport { protectTokenPackagePrices } from "@/lib/provider-economics";',
        "package billing import",
    )
    anchor = "/** Seed the DB with hardcoded defaults if it's empty. Runs once. */"
    helper = '''async function applyPackagePriceFloor(pkg: DbTokenPackage): Promise<DbTokenPackage> {\n  const protectedPrices = await protectTokenPackagePrices({\n    baseTokens: pkg.tokens,\n    bonusPct: pkg.bonusPct,\n    configuredPriceUSD: pkg.priceUSD,\n    configuredPriceGHS: pkg.priceGHS,\n  });\n  return {\n    ...pkg,\n    priceUSD: protectedPrices.priceUSD,\n    priceGHS: protectedPrices.priceGHS,\n    effectiveTokens: protectedPrices.effectiveTokens,\n    effectiveTokenPriceUSD: protectedPrices.priceUSD / protectedPrices.effectiveTokens,\n    effectiveTokenPriceGHS: protectedPrices.priceGHS / protectedPrices.effectiveTokens,\n  };\n}\n\nasync function protectPackageList(packages: DbTokenPackage[]): Promise<DbTokenPackage[]> {\n  return Promise.all(packages.map(applyPackagePriceFloor));\n}\n\n'''
    text = replace_once(text, anchor, helper + anchor, "package floor helpers")
    text = replace_once(text, "    return rows.map(rowToPackage);", "    return protectPackageList(rows.map(rowToPackage));", "admin package list floor")
    text = replace_once(text, "    const packages = rows.map(rowToPackage);", "    const packages = await protectPackageList(rows.map(rowToPackage));", "public package list floor")
    # getPackageBySlug plus createPackage plus updatePackage each return rowToPackage(row).
    expected = text.count("return rowToPackage(row);")
    if expected != 3:
        raise SystemExit(f"package row floor: expected 3 return rowToPackage(row) anchors, found {expected}")
    text = text.replace("return rowToPackage(row);", "return applyPackagePriceFloor(rowToPackage(row));")
    return text


def patch_packages_route(text: str) -> str:
    text = replace_once(
        text,
        'import { getChargeCurrency } from "@/lib/storefront";',
        'import { getChargeCurrency } from "@/lib/storefront";\nimport { getBillingPolicy, getPricingGhsPerUsd } from "@/lib/provider-economics";',
        "packages route billing import",
    )
    old = '''  const [packages, currency] = await Promise.all([\n    getActivePackages(),\n    getChargeCurrency(),\n  ]);'''
    new = '''  const [packages, currency, billingPolicy, ghsPerUsd] = await Promise.all([\n    getActivePackages(),\n    getChargeCurrency(),\n    getBillingPolicy(),\n    getPricingGhsPerUsd(),\n  ]);'''
    text = replace_once(text, old, new, "packages route policy load")
    text = replace_once(
        text,
        "      tokenValueGHS: 0.5,\n      tokenValueUSD: 0.05,",
        "      tokenValueGHS: Math.round(billingPolicy.tokenValueUsd * ghsPerUsd * (1 + billingPolicy.fxBufferPct / 100) * 100) / 100,\n      tokenValueUSD: billingPolicy.tokenValueUsd,",
        "packages route token valuation",
    )
    return text


def patch_config(text: str) -> str:
    anchor = '  admin_email: "Admin contact email",\n'
    addition = '''  admin_email: "Admin contact email",\n\n  // Billing economics. Percent values are entered as whole percentages.\n  "billing.token_value_usd": "USD sales value represented by one Vidora token",\n  "billing.target_margin_pct": "Target gross margin percentage after provider COGS and payment allowance",\n  "billing.provider_risk_buffer_pct": "Provider COGS safety buffer percentage for retries and price drift",\n  "billing.payment_fee_buffer_pct": "Payment processing cost allowance percentage",\n  "billing.fx_buffer_pct": "GHS foreign-exchange safety buffer percentage",\n'''
    text = replace_once(text, anchor, addition, "billing config schema")
    defaults_anchor = '  ai_text_provider: "zai",\n'
    defaults = '''  "billing.token_value_usd": "0.05",\n  "billing.target_margin_pct": "30",\n  "billing.provider_risk_buffer_pct": "5",\n  "billing.payment_fee_buffer_pct": "3",\n  "billing.fx_buffer_pct": "3",\n  ai_text_provider: "zai",\n'''
    text = replace_once(text, defaults_anchor, defaults, "billing config defaults")
    validation_anchor = '''  if (key.endsWith("_base_url") && value && !/^https:\\/\\//i.test(value)) {\n    throw new Error(`${key} must use HTTPS`);\n  }\n'''
    validation = validation_anchor + '''  if (key.startsWith("billing.")) {\n    const parsed = Number(value);\n    if (!Number.isFinite(parsed) || parsed < 0) {\n      throw new Error(`${key} must be a non-negative number`);\n    }\n    if (key === "billing.token_value_usd" && parsed <= 0) {\n      throw new Error("billing.token_value_usd must be greater than zero");\n    }\n    if (key !== "billing.token_value_usd" && parsed > 80) {\n      throw new Error(`${key} must not exceed 80%`);\n    }\n  }\n'''
    text = replace_once(text, validation_anchor, validation, "billing config validation")
    return text


def patch_qwen(text: str) -> str:
    old_result = '''export interface QwenTtsResult {\n  buffer: Buffer;\n  extension: "wav" | "mp3";\n  provider: "qwen";\n  model: string;\n  voice: string;\n}\n'''
    new_result = '''export interface QwenTtsResult {\n  buffer: Buffer;\n  extension: "wav" | "mp3";\n  provider: "qwen";\n  model: string;\n  voice: string;\n  /** Provider-reported billable input characters across all internal chunks. */\n  billableCharacters: number;\n  /** Provider request ids retained for support/cost reconciliation. */\n  providerRequestIds: string[];\n}\n'''
    text = replace_once(text, old_result, new_result, "Qwen result usage")
    old_synth = '''interface SynthesizedAudio extends DownloadedAudio {\n  voice: string;\n}\n'''
    new_synth = '''interface SynthesizedAudio extends DownloadedAudio {\n  voice: string;\n  billableCharacters: number;\n  providerRequestId: string | null;\n}\n'''
    text = replace_once(text, old_synth, new_synth, "Qwen chunk usage")
    old_return = '    if (!audioUrl) throw new Error("Qwen3-TTS returned no complete audio URL");\n    return { ...(await downloadAudio(audioUrl)), voice: opts.voice };'
    new_return = '''    if (!audioUrl) throw new Error("Qwen3-TTS returned no complete audio URL");\n    const usage = body?.usage && typeof body.usage === "object"\n      ? body.usage as Record<string, unknown>\n      : null;\n    const providerCharacters = Number(usage?.characters);\n    const billableCharacters = Number.isFinite(providerCharacters) && providerCharacters >= 0\n      ? Math.floor(providerCharacters)\n      : Array.from(opts.text).length;\n    const providerRequestId = typeof body?.request_id === "string" ? body.request_id : null;\n    return {\n      ...(await downloadAudio(audioUrl)),\n      voice: opts.voice,\n      billableCharacters,\n      providerRequestId,\n    };'''
    text = replace_once(text, old_return, new_return, "Qwen provider usage parse")
    used_voice = '  const usedVoice = audioParts[0]?.voice || voice;\n'
    totals = '''  const usedVoice = audioParts[0]?.voice || voice;\n  const billableCharacters = audioParts.reduce((sum, part) => sum + part.billableCharacters, 0);\n  const providerRequestIds = audioParts\n    .map((part) => part.providerRequestId)\n    .filter((id): id is string => Boolean(id));\n'''
    text = replace_once(text, used_voice, totals, "Qwen aggregate usage")
    single_old = '''      provider: "qwen",\n      model,\n      voice: usedVoice,\n    };'''
    single_new = '''      provider: "qwen",\n      model,\n      voice: usedVoice,\n      billableCharacters,\n      providerRequestIds,\n    };'''
    if text.count(single_old) != 2:
        raise SystemExit(f"Qwen result returns: expected 2 anchors, found {text.count(single_old)}")
    text = text.replace(single_old, single_new)
    return text


def patch_qwen_router(text: str) -> str:
    old = '''export type ProviderSpeechResult = Omit<BaseProviderSpeechResult, "provider"> & {\n  provider: TtsProviderId;\n};'''
    new = '''export type ProviderSpeechResult = Omit<BaseProviderSpeechResult, "provider"> & {\n  provider: TtsProviderId;\n  billableCharacters?: number;\n  providerRequestIds?: string[];\n};'''
    return replace_once(text, old, new, "Qwen router usage type")


def patch_narration(text: str) -> str:
    text = replace_once(
        text,
        '} from "@/lib/ai-provider-router";',
        '} from "@/lib/ai-provider-router-qwen";\nimport { DEFAULT_QWEN_TTS_MODEL } from "@/lib/qwen-tts";\nimport {\n  getBillingPolicy,\n  qwenBillableCharacterCount,\n  qwenTtsCostUsd,\n  quoteProviderCost,\n} from "@/lib/provider-economics";',
        "narration Qwen router",
    )
    old_model = '''  const providerModel = providerSettings.ttsProvider === "elevenlabs"\n    ? (providerSettings.ttsModel || "eleven_v3")\n    : (providerSettings.ttsModel || "zai-tts");'''
    new_model = '''  const providerModel = providerSettings.ttsProvider === "elevenlabs"\n    ? (providerSettings.ttsModel || "eleven_v3")\n    : providerSettings.ttsProvider === "qwen"\n      ? (providerSettings.ttsModel || DEFAULT_QWEN_TTS_MODEL)\n      : (providerSettings.ttsModel || "zai-tts");'''
    text = replace_once(text, old_model, new_model, "narration provider model")
    old_cost = '''  const operationKey = `tts:${userId}:${scene.id}:${fingerprint}`;\n  const tokensToCharge = chunks.length * PRICING.tts.tokens;\n  const costUsd = chunks.length * PRICING.tts.costUsd;'''
    new_cost = '''  const operationKey = `tts:${userId}:${scene.id}:${fingerprint}`;\n  const billingPolicy = await getBillingPolicy();\n  const qwenCharacters = providerSettings.ttsProvider === "qwen"\n    ? chunks.reduce((sum, chunk) => sum + qwenBillableCharacterCount(chunk.text), 0)\n    : 0;\n  const costUsd = providerSettings.ttsProvider === "qwen"\n    ? qwenTtsCostUsd(qwenCharacters)\n    : chunks.length * PRICING.tts.costUsd;\n  const providerQuote = quoteProviderCost(costUsd, billingPolicy);\n  const tokensToCharge = providerSettings.ttsProvider === "qwen"\n    ? providerQuote.requiredTokens\n    : Math.max(chunks.length * PRICING.tts.tokens, providerQuote.requiredTokens);'''
    text = replace_once(text, old_cost, new_cost, "narration provider cost quote")
    text = replace_once(
        text,
        '    description: `Generate ${chunks.length}-part ${profile.language} scene dialogue performance for scene ${scene.id}`,',
        '    description: `Generate ${chunks.length}-part ${profile.language} scene dialogue performance via ${providerSettings.ttsProvider} for scene ${scene.id}`,',
        "narration billing description",
    )
    text = replace_once(
        text,
        '  const tempChunkPaths: string[] = [];\n  try {',
        '  const tempChunkPaths: string[] = [];\n  let actualQwenCostUsd = 0;\n  try {',
        "narration actual cost accumulator",
    )
    speech_anchor = '''      const speech = await synthesizeProviderSpeech({\n        input: chunks[i].text,\n        voice: chunks[i].voice,\n        language: profile.language,\n        accent: profile.accent,\n        direction: chunks[i].direction,\n        speed,\n      });'''
    speech_new = speech_anchor + '''\n      if (speech.provider === "qwen") {\n        const billedCharacters = speech.billableCharacters ?? qwenBillableCharacterCount(chunks[i].text);\n        actualQwenCostUsd += qwenTtsCostUsd(billedCharacters);\n      }'''
    text = replace_once(text, speech_anchor, speech_new, "narration measured Qwen usage")
    concat_anchor = '    const concatenated = await concatWavChunks(tempChunkPaths, finalPath);\n'
    concat_new = '''    if (providerSettings.ttsProvider === "qwen" && deduction.transactionId) {\n      await db.tokenTransaction.update({\n        where: { id: deduction.transactionId },\n        data: { costUsd: actualQwenCostUsd },\n      });\n    }\n\n    const concatenated = await concatWavChunks(tempChunkPaths, finalPath);\n'''
    text = replace_once(text, concat_anchor, concat_new, "narration Qwen settlement")
    catch_anchor = '''  } catch (err) {\n    for (const p of tempChunkPaths) {\n      await unlink(p).catch(() => undefined);\n    }'''
    catch_new = '''  } catch (err) {\n    for (const p of tempChunkPaths) {\n      await unlink(p).catch(() => undefined);\n    }\n    if (providerSettings.ttsProvider === "qwen" && deduction.transactionId && actualQwenCostUsd > 0) {\n      await db.tokenTransaction.update({\n        where: { id: deduction.transactionId },\n        data: { costUsd: actualQwenCostUsd },\n      }).catch(() => undefined);\n    }'''
    text = replace_once(text, catch_anchor, catch_new, "narration partial Qwen settlement")
    return text


def patch_page(text: str) -> str:
    text = replace_once(
        text,
        '''      if (data.success) {\n        if (data.alreadyDone) {''',
        '''      if (data.success) {\n        if (typeof data.remainingTokens === "number") setUserTokens(data.remainingTokens);\n        if (data.alreadyDone) {''',
        "batch generation balance refresh",
    )
    text = replace_once(
        text,
        '''      if (data.success) {\n        // Sync immediately — the backend marks the scene "generating"''',
        '''      if (data.success) {\n        if (typeof data.remainingTokens === "number") setUserTokens(data.remainingTokens);\n        // Sync immediately — the backend marks the scene "generating"''',
        "single generation balance refresh",
    )
    text = replace_once(
        text,
        '''      if (data.success) {\n        toast({\n          title: "Narration generated",''',
        '''      if (data.success) {\n        if (typeof data.remainingTokens === "number") setUserTokens(data.remainingTokens);\n        toast({\n          title: "Narration generated",''',
        "narration balance refresh",
    )
    return text


patch("src/lib/pricing.ts", patch_pricing)
patch("src/lib/storefront.ts", patch_storefront)
patch("src/lib/token-packages.ts", patch_packages)
patch("src/app/api/payments/packages/route.ts", patch_packages_route)
patch("src/app/api/admin/config/route.ts", patch_config)
patch("src/lib/qwen-tts.ts", patch_qwen)
patch("src/lib/ai-provider-router-qwen.ts", patch_qwen_router)
patch("src/lib/narration.ts", patch_narration)
patch("src/app/page.tsx", patch_page)
