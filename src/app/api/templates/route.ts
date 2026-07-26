import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { seedTemplates } from "@/lib/template-seeds";

/**
 * GET /api/templates
 * Returns all active project templates for the marketplace.
 * Query: ?category=xxx for filtering, ?featured=true for featured only.
 */
export async function GET(req: NextRequest) {
  try {
    // Auto-seed if empty
    const count = await db.projectTemplate.count();
    if (count === 0) {
      await seedTemplates();
    }

    const url = req.nextUrl;
    const category = url.searchParams.get("category");
    const featured = url.searchParams.get("featured") === "true";

    const where: Record<string, unknown> = { isActive: true };
    if (category && category !== "all") where.category = category;
    if (featured) where.isFeatured = true;

    const templates = await db.projectTemplate.findMany({
      where,
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }],
    });

    const categories = await db.projectTemplate.findMany({
      where: { isActive: true },
      select: { category: true },
      distinct: ["category"],
    });

    return NextResponse.json({
      success: true,
      templates: templates.map((t) => ({
        ...t,
        sceneTemplates: JSON.parse(t.sceneTemplates),
      })),
      categories: categories.map((c) => c.category),
    });
  } catch (error) {
    console.error("[templates GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load templates" }, { status: 500 });
  }
}
