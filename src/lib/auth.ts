import { NextAuthOptions, User as NextAuthUser } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

function productionSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[auth] NEXTAUTH_SECRET not set — using dev-only fallback");
      return "vidora-dev-secret-do-not-use-in-production";
    }
    throw new Error("FATAL: NEXTAUTH_SECRET is required in production");
  }
  if (process.env.NODE_ENV === "production") {
    const forbidden = new Set([
      "vidora-secret-change-in-production-2024",
      "vidora-dev-secret-do-not-use-in-production",
      "change-me",
      "changeme",
    ]);
    if (secret.length < 32 || forbidden.has(secret)) {
      throw new Error("FATAL: NEXTAUTH_SECRET is weak or is a known example/default value");
    }
  }
  return secret;
}

export const authOptions: NextAuthOptions = {
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = String(credentials.email).trim().toLowerCase();
        const user = await db.user.findUnique({ where: { email } });
        if (!user?.password || !user.isActive) return null;
        if (!(await bcrypt.compare(String(credentials.password), user.password))) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tokens: user.tokens,
          image: user.image,
          sessionVersion: user.sessionVersion,
        } as NextAuthUser & { role: string; tokens: number; sessionVersion: number };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as NextAuthUser & { role: string }).role;
        token.tokens = (user as NextAuthUser & { tokens: number }).tokens;
        token.sessionVersion = (user as NextAuthUser & { sessionVersion: number }).sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const target = session.user as Record<string, unknown>;
        target.id = token.id;
        target.role = token.role;
        target.tokens = token.tokens;
        target.sessionVersion = token.sessionVersion;
      }
      return session;
    },
  },
  pages: { signIn: "/?auth=login" },
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      name: `${process.env.NEXTAUTH_URL?.startsWith("https") ? "__Secure-" : ""}next-auth.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NEXTAUTH_URL?.startsWith("https") ?? false },
    },
    callbackUrl: {
      name: "next-auth.callback-url",
      options: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    csrfToken: {
      name: `${process.env.NEXTAUTH_URL?.startsWith("https") ? "__Secure-" : ""}next-auth.csrf-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/" },
    },
  },
  secret: productionSecret(),
};
