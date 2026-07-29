import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

/**
 * POST /api/auth/reset-password
 * Body: { token: string, email: string, password: string }
 *
 * Validates the reset token by recomputing its SHA-256 hash and looking it
 * up in SystemConfig. Checks expiry + email match. On success, hashes the
 * new password with bcrypt (12 rounds) and updates the user, then deletes
 * the consumed token so it can't be replayed.
 */
export async function POST(req: NextRequest) {
  try {
    const { token, email, password } = await req.json();

    // ── Basic validation ──
    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { success: false, error: "Invalid or missing reset token." },
        { status: 400 },
      );
    }
    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { success: false, error: "Email is required." },
        { status: 400 },
      );
    }
    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { success: false, error: "A new password is required." },
        { status: 400 },
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Password must be at least 8 characters long." },
        { status: 400 },
      );
    }
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Password must include an uppercase letter, a number, and a special character.",
        },
        { status: 400 },
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const configKey = `pwreset:${tokenHash}`;

    // ── Look up the token record ──
    const record = await db.systemConfig.findUnique({
      where: { key: configKey },
    });
    if (!record) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This reset link is invalid or has already been used. Please request a new one.",
        },
        { status: 400 },
      );
    }

    let payload: { userId?: string; email?: string; expiresAt?: string };
    try {
      payload = JSON.parse(record.value);
    } catch {
      return NextResponse.json(
        { success: false, error: "This reset link is malformed. Please request a new one." },
        { status: 400 },
      );
    }

    // ── Expiry check ──
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    if (!expiresAt || expiresAt.getTime() < Date.now()) {
      // clean up expired token
      await db.systemConfig.delete({ where: { key: configKey } }).catch(() => {});
      return NextResponse.json(
        {
          success: false,
          error: "This reset link has expired. Please request a new one.",
        },
        { status: 400 },
      );
    }

    // ── Email match check ──
    if (!payload.email || payload.email.trim().toLowerCase() !== normalizedEmail) {
      return NextResponse.json(
        { success: false, error: "This reset link does not match the provided email." },
        { status: 400 },
      );
    }

    // ── Hash + update ──
    const hashedPassword = await bcrypt.hash(password, 12);
    await db.user.update({
      where: { id: payload.userId },
      data: { password: hashedPassword },
    });

    // ── Consume the token (one-time use) ──
    await db.systemConfig.delete({ where: { key: configKey } }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Your password has been reset successfully. You can now sign in.",
    });
  } catch (err) {
    console.error("[reset-password] error:", err);
    return NextResponse.json(
      { success: false, error: "Unable to reset your password right now. Please try again later." },
      { status: 500 },
    );
  }
}
