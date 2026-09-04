import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { resetZaiClient } from "@/lib/zai";
import {
  SECRET_CONFIG_KEYS,
  getConfigValue,
  isMaskedSecret,
  maskSecret,
  setConfigValue,
} from "@/lib/secure-config";

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
  zai_base_url: "Z.ai API base URL (e.g. https://api.z.ai/api/paas/v4)",
  zai_api_key: "Z.ai API key (from your z.ai dashboard)",
};

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const rows = await db.systemConfig.findMany({ orderBy: { key: "asc" } });
    const rowMap = new Map(rows.map((row) => [row.key, row]));
    const result: Record<string, { value: string; description: string; configured?: boolean; secret?: boolean }> = {};

    for (const [key, description] of Object.entries(CONFIG_SCHEMA)) {
      if (SECRET_CONFIG_KEYS.has(key)) {
        let plaintext = "";
        try {
          const envName: Record<string, string> = {
            paystack_secret_key: "PAYSTACK_SECRET_KEY",
            paystack_webhook_secret: "PAYSTACK_SECRET_KEY",
            hubtel_client_id: "HUBTEL_CLIENT_ID",
            hubtel_client_secret: "HUBTEL_CLIENT_SECRET",
            hubtel_api_key: "HUBTEL_API_KEY",
            stripe_secret_key: "STRIPE_SECRET_KEY",
            stripe_webhook_secret: "STRIPE_WEBHOOK_SECRET",
            zai_api_key: "ZAI_API_KEY",
          };
          plaintext = await getConfigValue(key, envName[key]);
        } catch {
          // Never leak decryption/config diagnostics in the admin response.
          plaintext = "";
        }
        result[key] = {
          value: plaintext ? maskSecret(plaintext) : "",
          description,
          configured: Boolean(plaintext),
          secret: true,
        };
        continue;
      }

      result[key] = {
        value: rowMap.get(key)?.value || "",
        description,
        configured: Boolean(rowMap.get(key)?.value),
        secret: false,
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
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return NextResponse.json({ success: false, error: "Invalid configuration payload" }, { status: 400 });
    }

    const updatedKeys: string[] = [];
    for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
      if (!(key in CONFIG_SCHEMA)) continue;
      const strValue = String(value ?? "").trim();

      // The UI receives masked secret placeholders. Sending the placeholder
      // back must never replace the real credential.
      if (SECRET_CONFIG_KEYS.has(key) && isMaskedSecret(strValue)) continue;

      await setConfigValue(key, strValue, CONFIG_SCHEMA[key]);
      updatedKeys.push(key);
    }

    if (updatedKeys.includes("zai_base_url") || updatedKeys.includes("zai_api_key")) {
      resetZaiClient();
    }

    // Never echo raw configuration values, particularly provider credentials.
    return NextResponse.json({ success: true, updatedKeys });
  } catch (error) {
    console.error("Admin update config error:", error);
    return NextResponse.json({ success: false, error: "Failed to update config" }, { status: 500 });
  }
}
