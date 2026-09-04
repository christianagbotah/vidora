import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { loginLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

function authSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "development") return "vidora-dev-secret-do-not-use-in-production";
    throw new Error("NEXTAUTH_SECRET is required in production");
  }
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET is too short for production");
  }
  return secret;
}

export async function POST(req: NextRequest) {
  try {
    const { limited } = loginLimiter(req);
    if (limited) {
      return NextResponse.json({ error: "Too many login attempts. Please wait a minute and try again." }, { status: 429 });
    }

    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });

    const user = await db.user.findUnique({ where: { email } });
    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    if (!user.isActive) return NextResponse.json({ error: "Account is deactivated." }, { status: 403 });

    const token = await encode({
      token: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tokens: user.tokens,
        sessionVersion: user.sessionVersion,
      },
      secret: authSecret(),
    });

    const forwardedProto = req.headers.get("x-forwarded-proto") || "http";
    const isSecure = forwardedProto === "https";
    const cookieName = isSecure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
    const response = NextResponse.json({ success: true, user: { email: user.email, name: user.name } });
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    response.cookies.delete(isSecure ? "next-auth.session-token" : "__Secure-next-auth.session-token");
    return response;
  } catch (error) {
    console.error("[manual-session] login failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Internal server error during login." }, { status: 500 });
  }
}
