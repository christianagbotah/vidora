import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";

/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 *
 * Generates a cryptographically-secure reset token, stores its SHA-256 hash
 * in SystemConfig (key = `pwreset:<hash>`) with a 30-minute expiry, and logs
 * the reset URL to the server console (email delivery is not wired up in this
 * environment — the console link is how the owner retrieves it for now).
 *
 * Anti-enumeration: always returns the same generic success message whether
 * or not the email exists, so an attacker cannot probe which emails are
 * registered.
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { success: false, error: "Email is required." },
        { status: 400 },
      );
    }
    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid email address." },
        { status: 400 },
      );
    }

    // Look up the user (but never reveal whether they exist)
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, name: true },
    });

    if (user) {
      // Generate a 32-byte random token, hex-encoded (64 chars)
      const tokenBytes = crypto.randomBytes(32);
      const token = tokenBytes.toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min
      const configKey = `pwreset:${tokenHash}`;
      const configValue = JSON.stringify({
        userId: user.id,
        email: user.email,
        expiresAt: expiresAt.toISOString(),
      });

      // upsert so re-requests replace any prior token for the same hash
      await db.systemConfig.upsert({
        where: { key: configKey },
        update: { value: configValue },
        create: {
          key: configKey,
          value: configValue,
          description: "Password reset token (SHA-256 hashed)",
        },
      });

      // Build the reset URL and log it (email not configured in this env).
      const origin = req.nextUrl.origin;
      const resetUrl = `${origin}/?reset=${token}&email=${encodeURIComponent(user.email)}`;
      console.log(
        `\n[password-reset] Reset link for ${user.email}:\n  ${resetUrl}\nExpires at ${expiresAt.toISOString()}\n`,
      );
    }

    // Always return the same message (anti-enumeration)
    return NextResponse.json({
      success: true,
      message:
        "If an account exists for that email, a password reset link has been sent. The link expires in 30 minutes.",
    });
  } catch (err) {
    console.error("[forgot-password] error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Unable to process your request right now. Please try again later.",
      },
      { status: 500 },
    );
  }
}
