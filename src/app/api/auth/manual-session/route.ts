import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Manual session creation endpoint.
 *
 * Why this exists:
 *   NextAuth's /api/auth/callback/credentials returns a 302 redirect with the
 *   session cookie. When the client uses fetch() with redirect:"manual", the
 *   browser receives an "opaqueredirect" response and does NOT reliably
 *   process Set-Cookie headers. This endpoint returns a plain 200 OK so
 *   fetch() processes the cookie normally.
 *
 * The JWT is produced with next-auth/jwt's encode(), so it's fully compatible
 * with every other NextAuth session check.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    // 1. Look up user
    const user = await db.user.findUnique({ where: { email: email as string } });
    if (!user || !user.password) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // 2. Verify password
    const isValid = await bcrypt.compare(password as string, user.password);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // 3. Check active
    if (!user.isActive) {
      return NextResponse.json(
        { error: "Account is deactivated." },
        { status: 403 }
      );
    }

    // 4. Create a NextAuth-compatible JWT
    const secret =
      process.env.NEXTAUTH_SECRET || "vidora-secret-change-in-production-2024";

    const token = await encode({
      token: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tokens: user.tokens,
        // next-auth/jwt also stores iat/exp automatically
      },
      secret,
    });

    // 5. Determine cookie attributes from the proxy headers
    //    Caddy (and most reverse proxies) set X-Forwarded-Proto.
    const forwardedProto = req.headers.get("x-forwarded-proto") || "http";
    const isSecure = forwardedProto === "https";
    const cookieName = isSecure
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token";

    // 6. Build response with the session cookie
    const response = NextResponse.json({
      success: true,
      user: { email: user.email, name: user.name },
    });

    response.cookies.set(cookieName, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    // 7. Also clear any stale __Host- or __Secure- variant that might conflict
    const altName = isSecure
      ? "next-auth.session-token"
      : "__Secure-next-auth.session-token";
    response.cookies.delete(altName);

    return response;
  } catch (err) {
    console.error("[manual-session] Error:", err);
    return NextResponse.json(
      { error: "Internal server error during login." },
      { status: 500 }
    );
  }
}
