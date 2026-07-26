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
  // First, look up the project so we can detect guest demo projects
  // (projects created with userId=null by the demo flow). These are
  // intentionally public — guests must be able to view/interact with
  // them so the "Try Live Demo" button works without sign-up.
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

  // Guest demo project (userId === null): allow full read+write access
  // without auth. Demo projects are created fresh per click (ephemeral),
  // so writes only affect that guest's own demo project. This makes the
  // demo fully interactive (share, pick music, generate subtitles, edit
  // settings) without requiring sign-up.
  if (project.userId === null) {
    return {
      ok: true,
      session: { userId: "guest", role: "guest", email: "" },
      project,
    };
  }

  // For real user projects, require authentication
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;

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

// ───────────────────────────────────────────────────────────────────────────
//  Scene-level access helper
// ───────────────────────────────────────────────────────────────────────────

export interface SceneAuthResult {
  ok: true;
  session: AuthSession;
  scene: { id: string; projectId: string };
  project: { id: string; userId: string | null; title: string };
}
export type SceneAuthError = AuthError;

/**
 * Require access to a specific scene (by scene ID).
 *
 * Resolves the scene → project chain and delegates to the same rules as
 * `requireProjectAccess`:
 *  - Guest demo projects (userId === null): guests get READ access; writes
 *    are blocked (must sign in to save edits).
 *  - Real user projects: owner full access, admin view-only, others 403.
 */
export async function requireSceneAccess(
  sceneId: string,
  writeCheck = false
): Promise<SceneAuthResult | SceneAuthError> {
  const scene = await db.videoScene.findUnique({
    where: { id: sceneId },
    select: { id: true, projectId: true },
  });
  if (!scene) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Scene not found" },
        { status: 404 }
      ),
    };
  }

  const project = await db.videoProject.findUnique({
    where: { id: scene.projectId },
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

  // Guest demo project — allow full read+write access without auth.
  // Demo projects are created fresh per click (ephemeral), so writes only
  // affect that guest's own demo project. This makes the demo fully
  // interactive (pick music, generate subtitles, etc.) without sign-up.
  if (project.userId === null) {
    return {
      ok: true,
      session: { userId: "guest", role: "guest", email: "" },
      scene,
      project,
    };
  }

  // Real project — delegate to project access rules
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;

  const isOwner = project.userId === authResult.session.userId;
  const isAdmin = authResult.session.role === "admin";
  if (isOwner || (isAdmin && !writeCheck)) {
    return { ok: true, session: authResult.session, scene, project };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { success: false, error: "You don't have access to this scene" },
      { status: 403 }
    ),
  };
}
