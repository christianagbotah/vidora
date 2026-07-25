import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths that don't require auth
  const publicPaths = ["/", "/api/auth/register", "/api/auth/"];

  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // API routes that don't require auth
  const publicApiPaths = [
    "/api/auth/register",
    "/api/auth/",
    "/api/payments/webhook",
    "/api/payments/packages",
  ];

  if (publicApiPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // For now, allow all routes in development
  // On production VPS with PostgreSQL + NextAuth, uncomment the checks below:
  /*
  // Get session token from cookie
  const token = req.cookies.get("next-auth.session-token")?.value ||
    req.cookies.get("__Secure-next-auth.session-token")?.value;

  if (!token) {
    // API routes return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Page routes redirect to login
    return NextResponse.redirect(new URL("/?auth=login", req.url));
  }

  // Admin routes
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    // In production, decode JWT to check role
    // For now, we rely on the API-layer admin check
  }
  */

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|generated|public).*)",
  ],
};
