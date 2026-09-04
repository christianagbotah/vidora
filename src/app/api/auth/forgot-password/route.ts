import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { passwordResetLimiter } from "@/lib/rate-limit";
import { sendPasswordResetEmail } from "@/lib/email";

const GENERIC_MESSAGE = "If an account exists for that email, a password reset link has been sent. The link expires in 30 minutes.";

export async function POST(req: NextRequest) {
  try {
    const { limited } = passwordResetLimiter(req);
    if (limited) return NextResponse.json({ success: false, error: "Too many password reset attempts. Please try again later." }, { status: 429 });

    const { email } = await req.json();
    if (!email || typeof email !== "string") return NextResponse.json({ success: false, error: "Email is required." }, { status: 400 });
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ success: false, error: "Please enter a valid email address." }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email: normalizedEmail }, select: { id: true, email: true, name: true } });
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      const configKey = `pwreset:${tokenHash}`;
      await db.systemConfig.create({
        data: {
          key: configKey,
          value: JSON.stringify({ userId: user.id, email: user.email, expiresAt: expiresAt.toISOString() }),
          description: "Password reset token (SHA-256 hashed)",
        },
      });

      try {
        const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL;
        if (!baseUrl) throw new Error("Production base URL is not configured");
        const resetUrl = new URL("/", baseUrl);
        resetUrl.searchParams.set("reset", token);
        resetUrl.searchParams.set("email", user.email);
        await sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetUrl: resetUrl.toString(),
          expiresMinutes: 30,
        });
      } catch (error) {
        // Never log the reset URL/token. Remove the unusable token so it cannot
        // linger in the database after a delivery failure.
        await db.systemConfig.delete({ where: { key: configKey } }).catch(() => undefined);
        console.error("[forgot-password] reset email delivery failed", error instanceof Error ? error.message : "unknown error");
      }
    }

    return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
  } catch (error) {
    console.error("[forgot-password] request failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ success: false, error: "Unable to process your request right now." }, { status: 500 });
  }
}
