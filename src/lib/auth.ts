import { NextAuthOptions, User as NextAuthUser } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  // Required for proxied/reverse-proxy deployments (Caddy, Nginx)
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

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.password) return null;
        if (!user.isActive) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tokens: user.tokens,
          image: user.image,
        } as NextAuthUser & { role: string; tokens: number };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as NextAuthUser & { role: string }).role;
        token.tokens = (user as NextAuthUser & { tokens: number }).tokens;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).id = token.id;
        (session.user as Record<string, unknown>).role = token.role;
        (session.user as Record<string, unknown>).tokens = token.tokens;
      }
      return session;
    },
  },
  pages: {
    signIn: "/?auth=login",
  },
  session: {
    strategy: "jwt",
  },
  // Force cookie settings that work in proxied environments
  cookies: {
    sessionToken: {
      name: `${process.env.NEXTAUTH_URL?.startsWith("https") ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NEXTAUTH_URL?.startsWith("https") ?? false,
      },
    },
    callbackUrl: {
      name: "next-auth.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
    csrfToken: {
      name: `${process.env.NEXTAUTH_URL?.startsWith("https") ? "__Secure-" : ""}next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
  },
  secret: (() => {
    const s = process.env.NEXTAUTH_SECRET;
    if (!s) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[auth] NEXTAUTH_SECRET not set — using dev-only fallback. " +
          "NEVER use this fallback in production."
        );
        return "vidora-dev-secret-do-not-use-in-production";
      }
      throw new Error(
        "FATAL: NEXTAUTH_SECRET environment variable is required in production. " +
        "Generate one with: openssl rand -base64 32"
      );
    }
    return s;
  })(),
};
