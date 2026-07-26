import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  getAllPackagesForAdmin,
  createPackage,
  resetToDefaults,
  type PackageInput,
} from "@/lib/token-packages";

/**
 * GET /api/admin/packages
 *   Returns ALL packages (active + inactive), sorted by sortOrder.
 *   Admin-only. Bypasses cache so edits are immediately visible.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const packages = await getAllPackagesForAdmin();
    return NextResponse.json({ success: true, packages });
  } catch (err) {
    console.error("Admin get packages error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load packages" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/packages
 *   Create a new package. Body: PackageInput (partial — sane defaults applied).
 *   Special: { action: "reset" } resets all packages to hardcoded defaults.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const body = await req.json();

    // Bulk reset to defaults
    if (body?.action === "reset") {
      const packages = await resetToDefaults();
      return NextResponse.json({ success: true, packages, reset: true });
    }

    const input: PackageInput = {
      slug: body.slug,
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

    const pkg = await createPackage(input);
    return NextResponse.json({ success: true, package: pkg });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create package";
    // Prisma unique-constraint violation on slug → friendly message
    if (String(err).includes("Unique constraint")) {
      return NextResponse.json(
        { success: false, error: "A package with that slug already exists. Use a different slug." },
        { status: 409 }
      );
    }
    console.error("Admin create package error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
