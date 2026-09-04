import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

// POST /api/admin/config/seed — seed only non-secret operational defaults.
// Provider credentials are environment-only and must never be inserted into
// SystemConfig by a convenience endpoint.
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const defaults: Array<{ key: string; value: string; description: string }> = [
      {
        key: "payment_gateway",
        value: "paystack",
        description: "Active payment gateway (paystack, hubtel, stripe)",
      },
      {
        key: "paystack_public_key",
        value: "",
        description: "Paystack API public key",
      },
      {
        key: "paystack_currency",
        value: "GHS",
        description: "Paystack payment currency",
      },
      {
        key: "hubtel_currency",
        value: "GHS",
        description: "Hubtel payment currency",
      },
      {
        key: "stripe_publishable_key",
        value: "",
        description: "Stripe publishable key",
      },
      {
        key: "download_token_cost",
        value: "0",
        description: "Number of tokens required per video download",
      },
      {
        key: "site_name",
        value: "Vidora",
        description: "Site name displayed to users",
      },
      {
        key: "admin_email",
        value: "",
        description: "Admin contact email",
      },
    ];

    await db.$transaction(
      defaults.map((item) =>
        db.systemConfig.upsert({
          where: { key: item.key },
          create: item,
          // Preserve an administrator's existing value; only refresh metadata.
          update: { description: item.description },
        })
      )
    );

    return NextResponse.json({
      success: true,
      message: `Seeded ${defaults.length} non-secret default configs`,
    });
  } catch (error) {
    console.error(
      "POST /api/admin/config/seed error:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to seed configuration" },
      { status: 500 }
    );
  }
}
