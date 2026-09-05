import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { resetZaiClient } from "@/lib/zai";
import { SECRET_CONFIG_KEYS, setConfigValue } from "@/lib/secure-config";

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
  stripe_publishable_key: "Stripe API publishable key",
  stripe_webhook_secret: "Stripe webhook signing secret",
  download_token_cost: "Number of tokens required per video download",
  site_name: "Site name displayed to users",
  admin_email: "Admin contact email",

  // Capability routing. These are intentionally independent: the strongest
  // story model can be paired with Z.ai video and a dedicated TTS provider.
  ai_text_provider: "Text/story provider: zai, xai, or compatible",
  ai_text_model: "Optional text model override for the active provider",
  ai_text_fallback_provider: "Text fallback provider: none, zai, xai, or compatible",
  ai_tts_provider: "Voice/TTS provider: zai or elevenlabs",
  ai_tts_model: "Optional TTS model override for the active provider",

  zai_base_url: "Z.ai API base URL (e.g. https://api.z.ai/api/paas/v4)",
  zai_api_key: "Z.ai API key (from your z.ai dashboard)",

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
  xai_api_key: "XAI_API_KEY",
  elevenlabs_api_key: "ELEVENLABS_API_KEY",
  compatible_api_key: "AI_COMPATIBLE_API_KEY",
};

const DEFAULT_VALUES: Record<string, string> = {
  ai_text_provider: "zai",
  ai_text_model: "",
  ai_text_fallback_provider: "zai",
  ai_tts_provider: "zai",
  ai_tts_model: "",
  xai_base_url: "https://api.x.ai/v1",
  xai_text_model: "grok-4.6",
  elevenlabs_base_url: "https://api.elevenlabs.io/v1",
  elevenlabs_tts_model: "eleven_v3",
};

const ENUM_VALUES: Record<string, Set<string>> = {
  ai_text_provider: new Set(["zai", "xai", "compatible"]),
  ai_text_fallback_provider: new Set(["none", "zai", "xai", "compatible"]),
  ai_tts_provider: new Set(["zai", "elevenlabs"]),
};

function validateConfigValue(key: string, raw: string): string {
  const value = raw.trim();
  const allowed = ENUM_VALUES[key];
  if (allowed && !allowed.has(value.toLowerCase())) {
    throw new Error(`${key} must be one of: ${[...allowed].join(", ")}`);
  }
  if (key.endsWith("_base_url") && value && !/^https:\/\//i.test(value)) {
    throw new Error(`${key} must use HTTPS`);
  }
  if (key === "elevenlabs_voice_map" && value) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("elevenlabs_voice_map must be valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("elevenlabs_voice_map must be a JSON object");
    }
    for (const [logical, voiceId] of Object.entries(parsed as Record<string, unknown>)) {
      if (!logical.trim() || typeof voiceId !== "string" || !voiceId.trim()) {
        throw new Error("elevenlabs_voice_map entries must map non-empty names to non-empty voice IDs");
      }
    }
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
        const legacyDbConfigured = Boolean(rowMap.get(key)?.value);
        result[key] = {
          value: fromEnv || legacyDbConfigured ? "********" : "",
          description,
          configured: fromEnv || legacyDbConfigured,
          secret: true,
          source: fromEnv ? "environment" : legacyDbConfigured ? "legacy-db" : "none",
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
        tts: ["zai", "elevenlabs"],
      },
      secretPolicy: "Provider secrets are write-disabled in the web admin and must be managed through server environment variables.",
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
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return NextResponse.json({ success: false, error: "Invalid configuration payload" }, { status: 400 });
    }

    const updatedKeys: string[] = [];
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

    if (updatedKeys.includes("zai_base_url")) resetZaiClient();

    return NextResponse.json({
      success: true,
      updatedKeys,
      blockedSecretKeys,
      ...(blockedSecretKeys.length
        ? { warning: "Provider secrets were not changed. Update them in the VPS environment and restart the application." }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update config";
    console.error("Admin update config error:", error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
