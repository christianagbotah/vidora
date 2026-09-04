import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Next.js 16 "proxy" file convention (replaces middleware.ts).
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/") return NextResponse.next();

  const publicApiPrefixes = [
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/",
    "/api/payments/webhook",
    "/api/payments/packages",
    "/api/payments/verify",
    "/api/storefront/pricing",
    "/api/demo/",
    "/api/templates",
    "/api/share/",
    "/api/music/tracks",
    "/api/contact",
    "/api/ai/health",
    "/api/audio/",
    "/api/preview/image/",
  ];

  if (publicApiPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Authentication service is not configured" },
        { status: 503 }
      );
    }
    return NextResponse.next();
  }

  // A cookie's mere presence is not authentication. Decode and verify the JWT
  // signature at the proxy boundary, then let route-level helpers revalidate
  // ownership, account state, role, and sessionVersion against PostgreSQL.
  let token = null;
  try {
    token = await getToken({
      req,
      secret,
      secureCookie: req.nextUrl.protocol === "https:",
    });
  } catch {
    token = null;
  }

  if (!token?.id) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|generated|public).*)",
  ],
};
