import { NextResponse } from "next/server";
import { DEMO_TEMPLATES } from "@/lib/demo-templates";

/**
 * GET /api/demo/templates
 *
 * Lists available demo templates (metadata only — no DB records created).
 * Used by the frontend to render a "Choose your demo" gallery.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    templates: DEMO_TEMPLATES.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description.replace(/^\[DEMO\]\s*/, ""),
      style: t.style,
      aspectRatio: t.aspectRatio,
      targetDuration: t.targetDuration,
      projectType: t.projectType,
      coverImage: t.coverImage,
      accentColor: t.accentColor,
      tagline: t.tagline,
      sceneCount: t.scenes.length,
    })),
  });
}
