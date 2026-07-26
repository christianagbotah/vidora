import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

/**
 * GET /api/brand-kit
 * Returns the current user's brand kit (or null if not set).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
    }
    const userId = (session.user as Record<string, unknown>).id as string;
    let kit = await db.brandKit.findUnique({ where: { userId } });
    if (!kit) {
      // Auto-create a default brand kit
      kit = await db.brandKit.create({
        data: { userId, brandName: session.user.name || "My Brand" },
      });
    }
    return NextResponse.json({ success: true, brandKit: kit });
  } catch (error) {
    console.error("[brand-kit GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load brand kit" }, { status: 500 });
  }
}

/**
 * POST /api/brand-kit
 * Creates or updates the current user's brand kit.
 * Body: { brandName?, logoPosition?, logoOpacity?, logoScale?, primaryColor?, tagline?, website? }
 * Multipart form data with logo file is also supported (field name: "logo").
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
    }
    const userId = (session.user as Record<string, unknown>).id as string;

    let logoUrl: string | undefined;
    let body: Record<string, unknown> = {};

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const logoFile = formData.get("logo") as File | null;
      if (logoFile && logoFile.size > 0) {
        const buffer = Buffer.from(await logoFile.arrayBuffer());
        const ext = logoFile.name.split(".").pop()?.toLowerCase() || "png";
        const filename = `brand-${userId.slice(-8)}-${Date.now()}.${ext}`;
        const uploadDir = path.join(process.cwd(), "public", "uploads");
        await mkdir(uploadDir, { recursive: true });
        await writeFile(path.join(uploadDir, filename), buffer);
        logoUrl = `/uploads/${filename}`;
      }
      // Parse other fields
      for (const [key, value] of formData.entries()) {
        if (key !== "logo") body[key] = value;
      }
    } else {
      body = await req.json();
    }

    const data: Record<string, unknown> = {};
    if (body.brandName !== undefined) data.brandName = body.brandName;
    if (body.logoPosition !== undefined) data.logoPosition = body.logoPosition;
    if (body.logoOpacity !== undefined) data.logoOpacity = Number(body.logoOpacity);
    if (body.logoScale !== undefined) data.logoScale = Number(body.logoScale);
    if (body.primaryColor !== undefined) data.primaryColor = body.primaryColor || null;
    if (body.tagline !== undefined) data.tagline = body.tagline || null;
    if (body.website !== undefined) data.website = body.website || null;
    if (logoUrl) data.logoUrl = logoUrl;

    const existing = await db.brandKit.findUnique({ where: { userId } });
    let kit;
    if (existing) {
      kit = await db.brandKit.update({ where: { userId }, data });
    } else {
      kit = await db.brandKit.create({
        data: { userId, brandName: body.brandName as string || "My Brand", ...data },
      });
    }

    return NextResponse.json({ success: true, brandKit: kit });
  } catch (error) {
    console.error("[brand-kit POST]", error);
    return NextResponse.json({ success: false, error: "Failed to save brand kit" }, { status: 500 });
  }
}
