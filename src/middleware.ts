import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Public page routes (no auth needed) ──
  if (pathname === "/") return NextResponse.next();

  // ── Public API routes ──
  const publicApiPrefixes = [
    "/api/auth/register",      // registration
    "/api/auth/forgot-password", // password reset request
    "/api/auth/reset-password",  // password reset execution
    "/api/auth/",               // nextauth core (csrf, session, callback, etc.)
    "/api/payments/webhook",    // payment gateway callbacks
    "/api/payments/packages",   // list packages (needed before login)
    "/api/payments/verify",     // paystack client-side verify
    "/api/demo/",               // demo templates + create
    "/api/templates",           // template listing
    "/api/share/",              // public shared project view
    "/api/music/tracks",        // music library listing
    "/api/contact",             // contact form
    "/api/ai/health",           // health check
    "/api/audio/",              // audio file serving
    "/api/preview/image/",      // preview images
  ];

  if (publicApiPrefixes.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // ── Protected routes: check session cookie ──
  // We verify the cookie EXISTS at the edge (fast).  The actual JWT
  // validation + role checks happen in each API route via requireAuth().
  // This prevents unauthenticated requests from even reaching the app.
  const token =
    req.cookies.get("next-auth.session-token")?.value ||
    req.cookies.get("__Secure-next-auth.session-token")?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }
    // Page routes: let the client handle it (shows Sign In dialog)
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|generated|public).*)",
  ],
};
