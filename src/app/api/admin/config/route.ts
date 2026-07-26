import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

// System config keys and their descriptions
const CONFIG_SCHEMA: Record<string, string> = {
  payment_gateway: "Active payment gateway (paystack, hubtel, stripe)",
  paystack_secret_key: "Paystack API secret key",
  paystack_public_key: "Paystack API public key",
  paystack_webhook_secret: "Paystack webhook verification secret",
  paystack_currency: "Paystack payment currency",
  hubtel_client_id: "Hubtel API client ID",
  hubtel_client_secret: "Hubtel API client secret",
  hubtel_merchant_id: "Hubtel merchant account number",
  hubtel_api_key: "Hubtel API key",
  hubtel_currency: "Hubtel payment currency",
  stripe_secret_key: "Stripe API secret key",
  stripe_publishable_key: "Stripe API publishable key",
  download_token_cost: "Number of tokens required per video download",
  site_name: "Site name displayed to users",
  admin_email: "Admin contact email",
  // AI Providers
  ai_video_provider: "Video generation provider (replicate, luma, runway)",
  ai_video_api_key: "Video generation API key",
  ai_video_model: "Video generation model (e.g. stable-video-diffusion-xt)",
  ai_image_provider: "Image generation provider (replicate, stability, together)",
  ai_image_api_key: "Image generation API key",
  ai_image_model: "Image generation model (e.g. flux-pro, sdxl-turbo)",
  ai_tts_provider: "Text-to-speech provider (elevenlabs, openai, google)",
  ai_tts_api_key: "Text-to-speech API key",
  ai_tts_model: "TTS model (e.g. eleven_multilingual_v2, tts-1)",
  ai_llm_provider: "LLM provider (openai, anthropic, together)",
  ai_llm_api_key: "LLM API key (for AI Director & continuity checker)",
  ai_llm_model: "LLM model (e.g. gpt-4o, claude-3.5-sonnet, llama-3.1-70b)",
};

export async function GET() {
  try {
    const configs = await db.systemConfig.findMany({
      orderBy: { key: "asc" },
    });

    // Return all known configs, fill defaults for missing ones
    const result: Record<string, { value: string; description: string }> = {};
    for (const [key, description] of Object.entries(CONFIG_SCHEMA)) {
      const existing = configs.find((c) => c.key === key);
      result[key] = {
        value: existing?.value || "",
        description,
      };
    }

    return NextResponse.json({ success: true, configs: result });
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

    const results: Record<string, string> = {};

    // Use a transaction so all fields save atomically — no partial saves.
    await db.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(updates)) {
        if (!(key in CONFIG_SCHEMA)) continue;

        const strValue = String(value);
        const existing = await tx.systemConfig.findUnique({ where: { key } });

        if (existing) {
          await tx.systemConfig.update({
            where: { key },
            data: { value: strValue },
          });
        } else {
          await tx.systemConfig.create({
            data: {
              key,
              value: strValue,
              description: CONFIG_SCHEMA[key],
            },
          });
        }

        results[key] = strValue;
      }
    });

    return NextResponse.json({ success: true, updated: results });
  } catch (error) {
    console.error("Admin update config error:", error);
    return NextResponse.json({ success: false, error: "Failed to update config" }, { status: 500 });
  }
}
