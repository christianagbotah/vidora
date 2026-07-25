import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Admin-only route protection
export async function requireAdmin(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return { error: NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 }), session: null };
  }

  const role = (session.user as Record<string, unknown>).role as string;

  if (role !== "admin") {
    return { error: NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 }), session: null };
  }

  return { error: null, session };
}
