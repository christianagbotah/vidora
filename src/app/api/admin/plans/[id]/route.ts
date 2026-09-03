import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { updatePlan, deletePlan, type PlanInput } from "@/lib/storefront";

/**
 * PUT /api/admin/plans/[id] — admin
 *   Update a homepage pricing plan. `slug` is intentionally ignored (stable
 *   reference).
 *
 * DELETE /api/admin/plans/[id] — admin
 *   Hard-delete a plan (prefer isActive=false to hide it instead).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const { id } = await params;
    const body = await req.json();

    const input: Partial<PlanInput> = {
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

    const plan = await updatePlan(id, input);
    return NextResponse.json({ success: true, plan });
  } catch (err) {
    console.error("Admin update plan error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to update plan" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const { id } = await params;
    await deletePlan(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Admin delete plan error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to delete plan" },
      { status: 400 }
    );
  }
}
