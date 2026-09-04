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
    if (!user) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    const { password: _, ...safeUser } = user;
    return NextResponse.json({ success: true, user: safeUser });
  } catch (error) {
    console.error("Admin get user error:", error);
    return NextResponse.json({ success: false, error: "Failed to get user" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin.error) return admin.error;

  try {
    const { id } = await params;
    const body = await req.json();
    const role = body.role === undefined ? undefined : String(body.role);
    const isActive = body.isActive === undefined ? undefined : Boolean(body.isActive);
    const name = body.name === undefined ? undefined : String(body.name).trim();
    const tokens = body.tokens === undefined ? undefined : Number(body.tokens);

    if (role !== undefined && !new Set(["user", "admin"]).has(role)) {
      return NextResponse.json({ success: false, error: "Invalid role" }, { status: 400 });
    }
    if (tokens !== undefined && (!Number.isSafeInteger(tokens) || tokens < 0)) {
      return NextResponse.json({ success: false, error: "Token balance must be a non-negative integer" }, { status: 400 });
    }
    if (name !== undefined && (name.length < 2 || name.length > 80)) {
      return NextResponse.json({ success: false, error: "Name must be 2-80 characters" }, { status: 400 });
    }
    if (id === admin.currentUser.id && (role === "user" || isActive === false)) {
      return NextResponse.json(
        { success: false, error: "You cannot demote or deactivate your own active administrator account" },
        { status: 400 }
      );
    }

    const user = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${id}
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("User not found");

      const current = await tx.user.findUnique({ where: { id } });
      if (!current) throw new Error("User not found");

      const revokesSession =
        (role !== undefined && role !== current.role) ||
        (isActive !== undefined && isActive !== current.isActive);

      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(role !== undefined ? { role } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(tokens !== undefined ? { tokens } : {}),
          ...(revokesSession ? { sessionVersion: { increment: 1 } } : {}),
        },
      });

      if (tokens !== undefined && tokens !== current.tokens) {
        await tx.tokenTransaction.create({
          data: {
            userId: id,
            type: "adjustment",
            amount: tokens - current.tokens,
            description: `Admin token balance adjustment by ${admin.currentUser.email}`,
            referenceId: id,
            operationType: "admin_adjustment",
          },
        });
      }
      return updated;
    });

    const { password: _, ...safeUser } = user;
    return NextResponse.json({ success: true, user: safeUser });
  } catch (error) {
    if (error instanceof Error && error.message === "User not found") {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }
    console.error("Admin update user error:", error);
    return NextResponse.json({ success: false, error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (admin.error) return admin.error;

  try {
    const { id } = await params;
    if (id === admin.currentUser.id) {
      return NextResponse.json({ success: false, error: "You cannot deactivate your own administrator account" }, { status: 400 });
    }
    await db.user.update({
      where: { id },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
    return NextResponse.json({ success: true, message: "User deactivated and existing sessions revoked" });
  } catch (error) {
    console.error("Admin delete user error:", error);
    return NextResponse.json({ success: false, error: "Failed to deactivate user" }, { status: 500 });
  }
}
