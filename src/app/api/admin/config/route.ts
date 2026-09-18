import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { resetZaiClient } from "@/lib/zai";
import { SECRET_CONFIG_KEYS, setConfigValue } from "@/lib/secure-config";
import { normalizeWebProviderSecret } from "@/lib/provider-secret-policy";

const CONFIG_SCHEMA: Record<string, string> = {
  payment_gateway: "Active payment gateway (paystack, hubtel, stripe)",
  paystack_secret_key: "Paystack API secret key",
  paystack_public_key: "Paystack API public key",
  paystack_webhook_secret: "Paystack webhook verification secret",
  paystack_currency: "Paystack payment currency",
  hubtel_client_id: "Hubtel API client ID",
  hubtel_client_secret: "Hubtel API client secret",
  hubtel_merchant_id: "Hubtel merchant account number (legacy)",
  hubtel_merchant_account_number: "Hubtel merchant account number",
  hubtel_api_key: "Hubtel API key",
  hubtel_currency: "Hubtel payment currency",
  stripe_secret_key: "Stripe API secret key",
  stripe_publishable_key: "Stripe API public key",
  stripe_webhook_secret: "Stripe webhook signing secret",
  download_token_cost: "Number of tokens required per video download",
  site_name: "Site name displayed to users",
  admin_email: "Admin contact email",

  // Capability routing. These are intentionally independent: the strongest
  // story model can be paired with Z.ai video and a dedicated TTS provider.
  ai_text_provider: "Text/story provider: zai, xai, or compatible",
  ai_text_model: "Optional text model override for the active provider",
  ai_text_fallback_provider: "Text fallback provider: none, zai, xai, or compatible",
  ai_tts_provider: "Voice/TTS provider: zai, qwen, grok, or elevenlabs",
  ai_tts_model: "Optional TTS model override for the active provider",

  zai_base_url: "Z.ai API base URL for chat/image/video (e.g. https://api.z.ai/api/paas/v4)",
  zai_api_key: "Z.ai API key for chat/image/video (from your z.ai dashboard)",
  zai_tts_base_url: "Dedicated GLM-TTS base URL (default https://open.bigmodel.cn/api/paas/v4)",
  zai_tts_api_key: "Dedicated BigModel/Open Platform API key for GLM-TTS",

  qwen_tts_base_url: "Qwen3-TTS DashScope base URL (default Singapore international API)",
  qwen_tts_api_key: "Alibaba Cloud Model Studio / DashScope API key for Qwen3-TTS",
  qwen_tts_default_voice: "Default Qwen3-TTS system voice",
  qwen_tts_voice_map: "JSON map from Vidora logical voice/profile keys to Qwen3-TTS voice names",

  grok_tts_base_url: "Grok TTS API base URL (default https://api.x.ai/v1)",
  xai_tts_api_key: "Optional dedicated xAI API key for Grok TTS; falls back to XAI_API_KEY",
  grok_tts_default_voice: "Default Grok TTS narrator voice ID",
  grok_tts_voice_map: "JSON map from Vidora logical voice/profile keys to Grok voice IDs",

  xai_base_url: "xAI API base URL (default https://api.x.ai/v1)",
  xai_api_key: "xAI API key",
  xai_text_model: "Default xAI text model (e.g. grok-4.6)",

  elevenlabs_base_url: "ElevenLabs API base URL (default https://api.elevenlabs.io/v1)",
  elevenlabs_api_key: "ElevenLabs API key",
  elevenlabs_default_voice_id: "Default ElevenLabs voice ID",
  elevenlabs_voice_map: "JSON map from Vidora logical voice names/character voice IDs to ElevenLabs voice IDs",
  elevenlabs_tts_model: "Preferred ElevenLabs model (legacy compatibility; ai_tts_model wins when set)",

  compatible_base_url: "OpenAI-compatible API base URL",
  compatible_api_key: "OpenAI-compatible API key",
  compatible_text_model: "Default model for the OpenAI-compatible provider",

  fal_api_key: "fal API key for Sync-3 Talking Photo / lip-sync",
};

const SECRET_ENV: Record<string, string> = {
  paystack_secret_key: "PAYSTACK_SECRET_KEY",
  paystack_webhook_secret: "PAYSTACK_SECRET_KEY",
  hubtel_client_id: "HUBTEL_CLIENT_ID",
  hubtel_client_secret: "HUBTEL_CLIENT_SECRET",
  hubtel_api_key: "HUBTEL_API_KEY",
  stripe_secret_key: "STRIPE_SECRET_KEY",
  stripe_webhook_secret: "STRIPE_WEBHOOK_SECRET",
  zai_api_key: "ZAI_API_KEY",
  zai_tts_api_key: "ZAI_TTS_API_KEY",
  qwen_tts_api_key: "DASHSCOPE_API_KEY",
  xai_api_key: "XAI_API_KEY",
  xai_tts_api_key: "XAI_TTS_API_KEY",
  elevenlabs_api_key: "ELEVENLABS_API_KEY",
  compatible_api_key: "AI_COMPATIBLE_API_KEY",
  fal_api_key: "FAL_KEY",
};

const DEFAULT_VALUES: Record<string, string> = {
  ai_text_provider: "zai",
  ai_text_model: "",
  ai_text_fallback_provider: "zai",
  // Billing v2 has a verified, character-priced Qwen TTS catalog. Keep the
  // clean-install Admin view aligned with the runtime fallback so a blank DB
  // never advertises legacy Z.ai TTS while execution actually selects Qwen.
  ai_tts_provider: "qwen",
  ai_tts_model: "qwen3-tts-instruct-flash",
  zai_tts_base_url: "https://open.bigmodel.cn/api/paas/v4",
  qwen_tts_base_url: "https://dashscope-intl.aliyuncs.com/api/v1",
  qwen_tts_default_voice: "Cherry",
  qwen_tts_voice_map: "",
  grok_tts_base_url: "https://api.x.ai/v1",
  grok_tts_default_voice: "eve",
  grok_tts_voice_map: "",
  xai_base_url: "https://api.x.ai/v1",
  xai_text_model: "grok-4.6",
  elevenlabs_base_url: "https://api.elevenlabs.io/v1",
  elevenlabs_tts_model: "eleven_v3",
};

const ENUM_VALUES: Record<string, Set<string>> = {
  ai_text_provider: new Set(["zai", "xai", "compatible"]),
  ai_text_fallback_provider: new Set(["none", "zai", "xai", "compatible"]),
  ai_tts_provider: new Set(["zai", "qwen", "grok", "elevenlabs"]),
};

function validateVoiceMap(key: string, value: string): void {
  if (!value) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${key} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${key} must be a JSON object`);
  }
  for (const [logical, voiceId] of Object.entries(parsed as Record<string, unknown>)) {
    if (!logical.trim() || typeof voiceId !== "string" || !voiceId.trim()) {
      throw new Error(`${key} entries must map non-empty names to non-empty voice IDs/names`);
    }
  }
}

function validateConfigValue(key: string, raw: string): string {
  const value = raw.trim();
  const allowed = ENUM_VALUES[key];
  if (allowed && !allowed.has(value.toLowerCase())) {
    throw new Error(`${key} must be one of: ${[...allowed].join(", ")}`);
  }
  if (key.endsWith("_base_url") && value && !/^https:\/\//i.test(value)) {
    throw new Error(`${key} must use HTTPS`);
  }
  if (key === "elevenlabs_voice_map" || key === "qwen_tts_voice_map" || key === "grok_tts_voice_map") {
    validateVoiceMap(key, value);
  }
  return value;
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const rows = await db.systemConfig.findMany({ orderBy: { key: "asc" } });
    const rowMap = new Map(rows.map((row) => [row.key, row]));
    const result: Record<string, { value: string; description: string; configured: boolean; secret: boolean; source?: string }> = {};

    for (const [key, description] of Object.entries(CONFIG_SCHEMA)) {
      if (SECRET_CONFIG_KEYS.has(key)) {
        const envName = SECRET_ENV[key];
        const fromEnv = Boolean(envName && process.env[envName]?.trim());
        const dbConfigured = Boolean(rowMap.get(key)?.value);
        const inheritedXai = key === "xai_tts_api_key"
          && !fromEnv
          && !dbConfigured
          && (Boolean(rowMap.get("xai_api_key")?.value) || Boolean(process.env.XAI_API_KEY?.trim()));
        result[key] = {
          value: fromEnv || dbConfigured || inheritedXai ? "********" : "",
          description,
          configured: fromEnv || dbConfigured || inheritedXai,
          secret: true,
          // getConfigValue() resolves encrypted DB values before env fallback.
          source: dbConfigured
            ? "encrypted-database"
            : fromEnv
              ? "environment"
              : inheritedXai
                ? "shared-xai-key"
                : "none",
        };
        continue;
      }

      const value = rowMap.get(key)?.value || DEFAULT_VALUES[key] || "";
      result[key] = {
        value,
        description,
        configured: Boolean(value),
        secret: false,
        source: rowMap.get(key)?.value ? "database" : DEFAULT_VALUES[key] ? "default" : "none",
      };
    }

    return NextResponse.json({
      success: true,
      configs: result,
      providerCapabilities: {
        text: ["zai", "xai", "compatible"],
        video: ["zai"],
        tts: ["zai", "qwen", "grok", "elevenlabs"],
        talkingPhoto: ["fal"],
      },
      secretPolicy: "Optional execution-provider keys for TTS and fal Talking Photo may be entered by admins and are encrypted at rest. Grok TTS can reuse the server XAI_API_KEY when no dedicated TTS key is configured. Core text/video and payment secrets remain environment-managed.",
    });
  } catch (error) {
    console.error("Admin get config error:", error);
    return NextResponse.json({ success: false, error: "Failed to get config" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const body = await req.json();
    const updates = body.configs || body;
    const secretUpdates = body.secretConfigs;
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return NextResponse.json({ success: false, error: "Invalid configuration payload" }, { status: 400 });
    }
    if (secretUpdates !== undefined && (typeof secretUpdates !== "object" || secretUpdates === null || Array.isArray(secretUpdates))) {
      return NextResponse.json({ success: false, error: "Invalid secret configuration payload" }, { status: 400 });
    }

    const updatedKeys: string[] = [];
    const updatedSecretKeys: string[] = [];
    const blockedSecretKeys: string[] = [];

    for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
      if (!(key in CONFIG_SCHEMA)) continue;
      if (SECRET_CONFIG_KEYS.has(key)) {
        blockedSecretKeys.push(key);
        continue;
      }

      const normalized = validateConfigValue(key, String(value ?? ""));
      await setConfigValue(key, normalized, CONFIG_SCHEMA[key]);
      updatedKeys.push(key);
    }

    if (secretUpdates) {
      for (const [key, rawValue] of Object.entries(secretUpdates as Record<string, unknown>)) {
        if (!(key in CONFIG_SCHEMA) || !SECRET_CONFIG_KEYS.has(key)) {
          blockedSecretKeys.push(key);
          continue;
        }
        const normalized = normalizeWebProviderSecret(key, rawValue);
        // Blank input intentionally means "keep the currently configured key".
        if (!normalized) continue;
        await setConfigValue(key, normalized, CONFIG_SCHEMA[key]);
        updatedSecretKeys.push(key);
      }
    }

    if (updatedKeys.includes("zai_base_url")) resetZaiClient();

    return NextResponse.json({
      success: true,
      updatedKeys,
      updatedSecretKeys,
      blockedSecretKeys,
      ...(blockedSecretKeys.length
        ? { warning: "Some protected secrets were not changed. Only approved optional execution-provider keys can be saved from this page." }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update config";
    console.error("Admin update config error:", error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}