import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

// System config keys and their descriptions
const CONFIG_SCHEMA: Record<string, string> = {
  payment_gateway: "Active payment gateway (paystack, hubtel, stripe)",
  paystack_secret_key: "Paystack API secret key",
  paystack_public_key: "Paystack API public key",
  hubtel_client_id: "Hubtel API client ID",
  hubtel_client_secret: "Hubtel API client secret",
  hubtel_merchant_id: "Hubtel merchant account number",
  stripe_secret_key: "Stripe API secret key",
  stripe_publishable_key: "Stripe API publishable key",
  download_token_cost: "Number of tokens required per video download",
  site_name: "Site name displayed to users",
  admin_email: "Admin contact email",
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

    for (const [key, value] of Object.entries(updates)) {
      if (!(key in CONFIG_SCHEMA)) continue;

      const existing = await db.systemConfig.findUnique({ where: { key } });
      const strValue = String(value);

      if (existing) {
        await db.systemConfig.update({
          where: { key },
          data: { value: strValue },
        });
      } else {
        await db.systemConfig.create({
          data: {
            key,
            value: strValue,
            description: CONFIG_SCHEMA[key],
          },
        });
      }

      results[key] = strValue;
    }

    return NextResponse.json({ success: true, updated: results });
  } catch (error) {
    console.error("Admin update config error:", error);
    return NextResponse.json({ success: false, error: "Failed to update config" }, { status: 500 });
  }
}
