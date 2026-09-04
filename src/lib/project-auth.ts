import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export interface AuthSession {
  userId: string;
  role: string;
  email: string;
}
export interface AuthResult { ok: true; session: AuthSession; }
export interface AuthError { ok: false; response: NextResponse; }

export async function requireAuth(): Promise<AuthResult | AuthError> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Please sign in to continue" }, { status: 401 }) };
  }
  const user = session.user as Record<string, unknown>;
  const userId = typeof user.id === "string" ? user.id : "";
  const sessionVersion = Number(user.sessionVersion ?? -1);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Invalid session" }, { status: 401 }) };
  }

  const current = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true, isActive: true, sessionVersion: true },
  });
  if (!current?.isActive || current.sessionVersion !== sessionVersion) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Session expired" }, { status: 401 }) };
  }

  return { ok: true, session: { userId, role: current.role || "user", email: current.email || "" } };
}

export interface ProjectAuthResult {
  ok: true;
  session: AuthSession;
  project: { id: string; userId: string | null; title: string };
}

export async function requireProjectAccess(projectId: string, writeCheck = false): Promise<ProjectAuthResult | AuthError> {
  const project = await db.videoProject.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, title: true },
  });
  if (!project) return { ok: false, response: NextResponse.json({ success: false, error: "Project not found" }, { status: 404 }) };

  if (project.userId === null) {
    if (writeCheck) {
      return {
        ok: false,
        response: NextResponse.json({ success: false, error: "Sign in to modify a demo or use AI-powered studio actions" }, { status: 401 }),
      };
    }
    return { ok: true, session: { userId: "guest", role: "guest", email: "" }, project };
  }

  const authResult = await requireAuth();
  if (!authResult.ok) return authResult;
  const isOwner = project.userId === authResult.session.userId;
  const isAdmin = authResult.session.role === "admin";
  if (isOwner || (isAdmin && !writeCheck)) return { ok: true, session: authResult.session, project };
  return { ok: false, response: NextResponse.json({ success: false, error: "You don't have access to this project" }, { status: 403 }) };
}

export interface SceneAuthResult {
  ok: true;
  session: AuthSession;
  scene: { id: string; projectId: string };
  project: { id: string; userId: string | null; title: string };
}
export type SceneAuthError = AuthError;

export async function requireSceneAccess(sceneId: string, writeCheck = false): Promise<SceneAuthResult | SceneAuthError> {
  const scene = await db.videoScene.findUnique({ where: { id: sceneId }, select: { id: true, projectId: true } });
  if (!scene) return { ok: false, response: NextResponse.json({ success: false, error: "Scene not found" }, { status: 404 }) };
  const access = await requireProjectAccess(scene.projectId, writeCheck);
  if (!access.ok) return access;
  return { ok: true, session: access.session, scene, project: access.project };
}
