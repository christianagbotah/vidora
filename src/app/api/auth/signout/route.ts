import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explicit sign-out endpoint for Vidora's hybrid NextAuth/manual-session flow.
 *
 * Login is created by /api/auth/manual-session so the session cookie is set on
 * a 200 response (avoiding proxy/browser redirect-cookie issues).  NextAuth's
 * client signOut() still POSTs to /api/auth/signout.  Handling that exact route
 * lets us reliably expire every session-cookie variant that may exist from
 * current or legacy deployments, then return the JSON shape signOut() expects.
 */
export async function POST(req: NextRequest) {
  // Refuse an explicit cross-site POST while allowing same-origin browser calls
  // and non-browser clients that omit Sec-Fetch-Site.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return NextResponse.json({ error: "Cross-site sign out is not allowed." }, { status: 403 });
  }

  let callbackUrl = "/";
  try {
    const form = await req.formData();
    const requested = form.get("callbackUrl");
    if (typeof requested === "string" && requested.trim()) {
      const appOrigin = new URL(process.env.NEXTAUTH_URL || req.nextUrl.origin).origin;
      const candidate = new URL(requested, appOrigin);
      // Never allow sign-out to become an open redirect.
      if (candidate.origin === appOrigin) {
        callbackUrl = `${candidate.pathname}${candidate.search}${candidate.hash}` || "/";
      }
    }
  } catch {
    // signOut() normally sends form data.  A malformed body should still be
    // allowed to clear the local session and fall back to the home page.
  }

  const response = NextResponse.json({ url: callbackUrl });

  const cookies = [
    // Session cookie used by current HTTPS production and local/dev variants.
    { name: "__Secure-next-auth.session-token", secure: true },
    { name: "next-auth.session-token", secure: false },
    // Clear legacy/current auth-navigation state so a stale callback cannot
    // make a freshly signed-out browser appear to resume its prior session.
    { name: "next-auth.callback-url", secure: false },
    { name: "__Secure-next-auth.callback-url", secure: true },
    { name: "__Host-next-auth.csrf-token", secure: true },
    { name: "__Secure-next-auth.csrf-token", secure: true },
    { name: "next-auth.csrf-token", secure: false },
  ];

  for (const cookie of cookies) {
    response.cookies.set(cookie.name, "", {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });
  }

  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
