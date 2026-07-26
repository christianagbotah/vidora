import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  updatePackage,
  deletePackage,
  type PackageInput,
} from "@/lib/token-packages";

/**
 * PUT /api/admin/packages/[id]
 *   Update an existing package. Body: partial PackageInput.
 *   The `slug` is intentionally ignored (not updatable) so existing
 *   payment references / checkout links keep working after a rename.
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

    const input: Partial<PackageInput> = {
      name: body.name,
      tokens: body.tokens,
      priceGHS: body.priceGHS,
      priceUSD: body.priceUSD,
      bonusPct: body.bonusPct,
      popular: body.popular,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
      features: body.features,
    };

    const pkg = await updatePackage(id, input);
    return NextResponse.json({ success: true, package: pkg });
  } catch (err) {
    console.error("Admin update package error:", err);
    const message = err instanceof Error ? err.message : "Failed to update package";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/admin/packages/[id]
 *   Hard-deletes a package. Prefer setting isActive=false to preserve
 *   historical payment records, but hard delete is allowed for packages
 *   that were created in error and have no payments referencing them.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const { id } = await params;
    await deletePackage(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Admin delete package error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to delete package. It may be referenced by existing payments." },
      { status: 400 }
    );
  }
}
