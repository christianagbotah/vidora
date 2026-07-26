/**
 * ───────────────────────────────────────────────────────────────────────────
 *  Vidora — Project Authorization Helpers
 * ───────────────────────────────────────────────────────────────────────────
 *
 *  Enforces data isolation: every user's projects/scenes/characters are
 *  visible and mutable ONLY by that user. Admins can view all projects
 *  but cannot mutate projects they don't own (prevents accidental edits).
 *
 *  Every project-scoped API route MUST call one of these helpers to:
 *   1. Verify the user is authenticated
 *   2. Verify the project exists
 *   3. Verify the user owns the project (or is an admin viewing)
 * ───────────────────────────────────────────────────────────────────────────
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export interface AuthSession {
  userId: string;
  role: string;
  email: string;
}

export interface AuthResult {
  ok: true;
  session: AuthSession;
}

export interface AuthError {
  ok: false;
  response: NextResponse;
}

/**
 * Require an authenticated session. Returns the user ID + role on success,
 * or a 401 NextResponse on failure.
 */
export async function requireAuth(): Promise<AuthResult | AuthError> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Please sign in to continue" },
        { status: 401 }
      ),
    };
  }
  const user = session.user as Record<string, unknown>;
  return {
    ok: true,
    session: {
      userId: user.id as string,
      role: (user.role as string) || "user",
      email: (user.email as string) || "",
    },
  };
}

export interface ProjectAuthResult {
  ok: true;
  session: AuthSession;
  project: {
    id: string;
    userId: string | null;
    title: string;
  };
}

/**
 * Require auth + verify the user has access to a specific project.
 *
 * Access rules:
 *  - Owner: full access (view, edit, delete)
 *  - Admin: view-only access (can see all projects, but writeCheck blocks edits)
 *  - Other users: 403 Forbidden
 *
 * @param projectId The project ID from the URL
 * @param writeCheck If true, admins are also blocked (only the owner can write)
 */
export async function requireProjectAccess(
  projectId: string,
  writeCheck = false
): Promise<ProjectAuthResult | AuthError> {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;

  const project = await db.videoProject.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, title: true },
  });

  if (!project) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      ),
    };
  }

  const isOwner = project.userId === authResult.session.userId;
  const isAdmin = authResult.session.role === "admin";

  // Owner always has access
  if (isOwner) {
    return { ok: true, session: authResult.session, project };
  }

  // Admin has view-only access (blocked on writes)
  if (isAdmin && !writeCheck) {
    return { ok: true, session: authResult.session, project };
  }

  // No access
  return {
    ok: false,
    response: NextResponse.json(
      { success: false, error: "You don't have access to this project" },
      { status: 403 }
    ),
  };
}
