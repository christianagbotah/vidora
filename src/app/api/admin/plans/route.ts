import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createPlan, getAllPlansForAdmin, type PlanInput } from "@/lib/storefront";

/**
 * GET /api/admin/plans — admin
 *   All homepage pricing plans (active + inactive), sorted.
 *
 * POST /api/admin/plans — admin
 *   Create a plan. Body: PlanInput (partial — sane defaults applied).
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const plans = await getAllPlansForAdmin();
    return NextResponse.json({ success: true, plans });
  } catch (err) {
    console.error("Admin get plans error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load plans" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const body = await req.json();
    const input: Partial<PlanInput> = {
      slug: body.slug,
      name: body.name,
      badge: body.badge ?? null,
      priceGHS: body.priceGHS,
      priceUSD: body.priceUSD,
      period: body.period,
      features: body.features,
      ctaLabel: body.ctaLabel,
      ctaAction: body.ctaAction,
      highlight: body.highlight,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    };

    const plan = await createPlan(input);
    return NextResponse.json({ success: true, plan });
  } catch (err) {
    const message =
      err instanceof Error && (err.message === "Slug is required" || err.message === "Name is required")
        ? err.message
        : "Failed to create plan";
    // Prisma unique-constraint violation on slug → friendly message
    if (String(err).includes("Unique constraint")) {
      return NextResponse.json(
        { success: false, error: "A plan with that slug already exists. Use a different slug." },
        { status: 409 }
      );
    }
    console.error("Admin create plan error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
