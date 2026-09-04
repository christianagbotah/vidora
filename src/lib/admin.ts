import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function requireAdmin(_req?: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }), session: null };
  }

  const sessionUser = session.user as Record<string, unknown>;
  const userId = typeof sessionUser.id === "string" ? sessionUser.id : "";
  const sessionVersion = Number(sessionUser.sessionVersion ?? -1);
  if (!userId) {
    return { error: NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 }), session: null };
  }

  const currentUser = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, isActive: true, sessionVersion: true },
  });
  if (!currentUser || !currentUser.isActive || sessionVersion !== currentUser.sessionVersion) {
    return { error: NextResponse.json({ success: false, error: "Session expired" }, { status: 401 }), session: null };
  }
  if (currentUser.role !== "admin") {
    return { error: NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 }), session: null };
  }

  return { error: null, session, currentUser };
}
