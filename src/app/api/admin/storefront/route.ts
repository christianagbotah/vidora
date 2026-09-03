import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  getStorefrontDataForAdmin,
  saveEnginePricing,
  setChargeCurrency,
  resetEnginePricing,
  resetPlansToDefaults,
  type EnginePricingInput,
  type StorefrontCurrency,
} from "@/lib/storefront";

/**
 * GET /api/admin/storefront — admin
 *   Full storefront pricing state: charge currency + ALL plans (incl.
 *   inactive) + ALL engines (incl. inactive). Cache-bypassing so admin
 *   edits are immediately visible.
 *
 * PUT /api/admin/storefront — admin
 *   Body (all fields optional):
 *     { currency?: "GHS" | "USD",          // set charge currency
 *       engines?: EnginePricingInput[],     // bulk-save engine pricing
 *       action?: "reset-engines" | "reset-plans" | "reset-all" }
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const data = await getStorefrontDataForAdmin();
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error("Admin storefront read error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load storefront pricing" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const body = await req.json();

    // ── Reset actions ──
    if (body?.action) {
      switch (body.action) {
        case "reset-engines": {
          const engines = await resetEnginePricing();
          return NextResponse.json({ success: true, engines, reset: "engines" });
        }
        case "reset-plans": {
          const plans = await resetPlansToDefaults();
          return NextResponse.json({ success: true, plans, reset: "plans" });
        }
        case "reset-all": {
          const [engines, plans] = await Promise.all([resetEnginePricing(), resetPlansToDefaults()]);
          return NextResponse.json({ success: true, engines, plans, reset: "all" });
        }
        default:
          return NextResponse.json(
            { success: false, error: "Unknown action" },
            { status: 400 }
          );
      }
    }

    // ── Currency update ──
    if (body?.currency === "GHS" || body?.currency === "USD") {
      await setChargeCurrency(body.currency as StorefrontCurrency);
    }

    // ── Engine pricing bulk save ──
    if (Array.isArray(body?.engines)) {
      const entries: EnginePricingInput[] = body.engines
        .filter((e: Record<string, unknown>) => e && typeof e.modelId === "string")
        .map((e: Record<string, unknown>) => ({
          modelId: String(e.modelId),
          priceGHS: Number(e.priceGHS) || 0,
          priceUSD: Number(e.priceUSD) || 0,
          tokensPerClip: Number(e.tokensPerClip) || 1,
          isActive: Boolean(e.isActive),
        }));
      if (entries.length > 0) {
        await saveEnginePricing(entries);
      }
    }

    // Return the fresh full state so the admin UI updates in one round-trip.
    const data = await getStorefrontDataForAdmin();
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error("Admin storefront write error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to save storefront pricing" },
      { status: 400 }
    );
  }
}
