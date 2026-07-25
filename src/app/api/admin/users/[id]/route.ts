import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const { id } = await params;
    const user = await db.user.findUnique({
      where: { id },
      include: {
        projects: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { scenes: true, characters: true },
        },
        payments: { orderBy: { createdAt: "desc" }, take: 20 },
        transactions: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    // Remove password from response
    const { password: _, ...safeUser } = user;

    return NextResponse.json({ success: true, user: safeUser });
  } catch (error) {
    console.error("Admin get user error:", error);
    return NextResponse.json({ success: false, error: "Failed to get user" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const { id } = await params;
    const body = await req.json();
    const { role, tokens, isActive, name } = body;

    const user = await db.user.update({
      where: { id },
      data: {
        ...(role && { role }),
        ...(tokens !== undefined && { tokens }),
        ...(isActive !== undefined && { isActive }),
        ...(name && { name }),
      },
    });

    const { password: _, ...safeUser } = user;

    return NextResponse.json({ success: true, user: safeUser });
  } catch (error) {
    console.error("Admin update user error:", error);
    return NextResponse.json({ success: false, error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const { id } = await params;
    // Soft delete by deactivating
    await db.user.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true, message: "User deactivated" });
  } catch (error) {
    console.error("Admin delete user error:", error);
    return NextResponse.json({ success: false, error: "Failed to deactivate user" }, { status: 500 });
  }
}
