import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

/**
 * POST /api/share/[slug]/verify
 * Body: { password }
 * Returns { valid: boolean }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { password } = await req.json();
    const project = await db.videoProject.findUnique({ where: { shareSlug: slug } });
    if (!project || !project.isPublic) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    if (!project.sharePassword) {
      return NextResponse.json({ success: true, valid: true });
    }
    const valid = await bcrypt.compare(password || "", project.sharePassword);
    return NextResponse.json({ success: true, valid });
  } catch (error) {
    console.error("[share verify]", error);
    return NextResponse.json({ success: false, error: "Verification failed" }, { status: 500 });
  }
}
