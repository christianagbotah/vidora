import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/admin/config/seed — seed default gateway configs
export async function POST() {
  try {
    const defaults: Array<{ key: string; value: string; category: string; label: string; type: string }> = [
      // Paystack
      { key: "paystack_enabled", value: "false", category: "paystack", label: "Enable Paystack", type: "boolean" },
      { key: "paystack_public_key", value: "", category: "paystack", label: "Public Key", type: "text" },
      { key: "paystack_secret_key", value: "", category: "paystack", label: "Secret Key", type: "secret" },
      { key: "paystack_webhook_secret", value: "", category: "paystack", label: "Webhook Secret", type: "secret" },
      { key: "paystack_currency", value: "GHS", category: "paystack", label: "Currency", type: "text" },

      // Hubtel
      { key: "hubtel_enabled", value: "false", category: "hubtel", label: "Enable Hubtel", type: "boolean" },
      { key: "hubtel_client_id", value: "", category: "hubtel", label: "Client ID", type: "text" },
      { key: "hubtel_client_secret", value: "", category: "hubtel", label: "Client Secret", type: "secret" },
      { key: "hubtel_merchant_account_number", value: "", category: "hubtel", label: "Merchant Account Number", type: "text" },
      { key: "hubtel_api_key", value: "", category: "hubtel", label: "API Key", type: "secret" },
      { key: "hubtel_currency", value: "GHS", category: "hubtel", label: "Currency", type: "text" },

      // Pricing
      { key: "pricing_tokens_per_720p", value: "5", category: "pricing", label: "Tokens per 720p Export", type: "number" },
      { key: "pricing_tokens_per_1080p", value: "10", category: "pricing", label: "Tokens per 1080p Export", type: "number" },
      { key: "pricing_tokens_per_4k", value: "25", category: "pricing", label: "Tokens per 4K Export", type: "number" },
      { key: "pricing_tokens_per_scene_second", value: "1", category: "pricing", label: "Tokens per Scene Second", type: "number" },
      { key: "pricing_ghs_per_token", value: "0.50", category: "pricing", label: "GHS per Token", type: "number" },
      { key: "pricing_bonus_tokens_on_signup", value: "10", category: "pricing", label: "Bonus Tokens on Signup", type: "number" },
    ];

    let created = 0;
    for (const item of defaults) {
      await db.systemConfig.upsert({
        where: { key: item.key },
        create: item,
        update: { label: item.label },
      });
      created++;
    }

    return NextResponse.json({ success: true, message: `Seeded ${created} default configs` });
  } catch (error) {
    console.error("POST /api/admin/config/seed error:", error);
    return NextResponse.json({ success: false, error: "Failed to seed" }, { status: 500 });
  }
}
