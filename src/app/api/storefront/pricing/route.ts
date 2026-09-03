import { NextResponse } from "next/server";
import { getStorefrontData } from "@/lib/storefront";

/**
 * GET /api/storefront/pricing — PUBLIC
 *
 * Everything the storefront needs to render money-facing UI in one call:
 *   • currency — the admin-selected charge currency ("GHS" | "USD")
 *   • plans    — active homepage pricing cards (admin-managed)
 *   • engines  — active video engines with per-clip prices + token costs
 *
 * Falls back to hardcoded defaults when the DB is unreachable so the
 * homepage never breaks. Cached 60s in memory (invalidated on admin writes).
 */
export async function GET() {
  try {
    const data = await getStorefrontData();
    return NextResponse.json({
      success: true,
      currency: data.currency,
      plans: data.plans,
      engines: data.engines,
    });
  } catch (err) {
    console.error("Storefront pricing read error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load storefront pricing" },
      { status: 500 }
    );
  }
}
