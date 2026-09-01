import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { resetZaiClient } from "@/lib/zai";

// System config keys and their descriptions
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
  download_token_cost: "Number of tokens required per video download",
  site_name: "Site name displayed to users",
  admin_email: "Admin contact email",
  // Z.ai SDK (the actual AI backend used by Vidora)
  zai_base_url: "Z.ai API base URL (e.g. https://api.z.ai/api/paas/v4)",
  zai_api_key: "Z.ai API key (from your z.ai dashboard)",
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

    // If ZAI credentials changed, invalidate the cached client so next
    // call picks up the new values from the database.
    if ("zai_base_url" in results || "zai_api_key" in results) {
      resetZaiClient();
    }

    return NextResponse.json({ success: true, updated: results });
  } catch (error) {
    console.error("Admin update config error:", error);
    return NextResponse.json({ success: false, error: "Failed to update config" }, { status: 500 });
  }
}
