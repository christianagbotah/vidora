import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { token, email, password } = await req.json();
    if (!token || typeof token !== "string") return NextResponse.json({ success: false, error: "Invalid or missing reset token." }, { status: 400 });
    if (!email || typeof email !== "string") return NextResponse.json({ success: false, error: "Email is required." }, { status: 400 });
    if (!password || typeof password !== "string") return NextResponse.json({ success: false, error: "A new password is required." }, { status: 400 });
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return NextResponse.json({
        success: false,
        error: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
      }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const configKey = `pwreset:${tokenHash}`;
    const record = await db.systemConfig.findUnique({ where: { key: configKey } });
    if (!record) {
      return NextResponse.json({ success: false, error: "This reset link is invalid or has already been used." }, { status: 400 });
    }

    let payload: { userId?: string; email?: string; expiresAt?: string };
    try { payload = JSON.parse(record.value); }
    catch { return NextResponse.json({ success: false, error: "This reset link is malformed." }, { status: 400 }); }

    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    if (!expiresAt || expiresAt.getTime() < Date.now()) {
      await db.systemConfig.delete({ where: { key: configKey } }).catch(() => undefined);
      return NextResponse.json({ success: false, error: "This reset link has expired." }, { status: 400 });
    }
    if (!payload.userId || !payload.email || payload.email.trim().toLowerCase() !== normalizedEmail) {
      return NextResponse.json({ success: false, error: "This reset link does not match the provided email." }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await db.$transaction(async (tx) => {
      const lockKey = `vidora-password-reset:${payload.userId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      // Re-check and consume the one-time token in the same transaction as the
      // password change so a replay cannot race another reset request.
      const stillValid = await tx.systemConfig.findUnique({ where: { key: configKey } });
      if (!stillValid) throw new Error("Reset token already consumed");
      await tx.user.update({
        where: { id: payload.userId },
        data: { password: hashedPassword, sessionVersion: { increment: 1 } },
      });
      await tx.systemConfig.delete({ where: { key: configKey } });
    });

    return NextResponse.json({ success: true, message: "Your password has been reset successfully. Please sign in again." });
  } catch (error) {
    console.error("[reset-password] failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Unable to reset your password right now." }, { status: 500 });
  }
}
