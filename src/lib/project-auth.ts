import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_TEMPLATES, getDemoFinalVideo } from "@/lib/demo-templates";
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

type ProjectAccessRow = {
  id: string;
  userId: string | null;
  title: string;
  description: string | null;
  style: string;
  aspectRatio: string;
  targetDuration: number;
  projectType: string;
  finalVideoUrl: string | null;
};

function matchingDemoTemplate(project: ProjectAccessRow) {
  return DEMO_TEMPLATES.find((template) =>
    template.title === project.title &&
    template.description === project.description &&
    template.style === project.style &&
    template.aspectRatio === project.aspectRatio &&
    template.targetDuration === project.targetDuration &&
    template.projectType === project.projectType &&
    getDemoFinalVideo(template.id) === project.finalVideoUrl
  ) ?? null;
}

/**
 * Anonymous demos are public, read-only examples. A user may create one while
 * logged out, then sign in and continue working in the same Studio tab. Before
 * transferring ownership we verify the row still exactly matches a shipped
 * demo template, including every pre-rendered scene. This is intentionally
 * stricter than checking userId=null or a [DEMO] description: user deletion can
 * also leave ordinary projects ownerless through the Prisma onDelete:SetNull
 * relation and those projects must never become claimable by normal users.
 */
async function isPristineAnonymousDemo(project: ProjectAccessRow): Promise<boolean> {
  if (project.userId !== null) return false;
  const template = matchingDemoTemplate(project);
  if (!template) return false;

  const scenes = await db.videoScene.findMany({
    where: { projectId: project.id },
    orderBy: { sceneNumber: "asc" },
    select: {
      sceneNumber: true,
      title: true,
      prompt: true,
      enhancedPrompt: true,
      visualNote: true,
      dialogue: true,
      mood: true,
      cameraMove: true,
      musicMood: true,
      duration: true,
      transition: true,
      imageUrl: true,
      videoUrl: true,
    },
  });

  if (scenes.length !== template.scenes.length) return false;
  return scenes.every((scene, index) => {
    const expected = template.scenes[index];
    return Boolean(expected) &&
      scene.sceneNumber === expected.sceneNumber &&
      scene.title === expected.title &&
      scene.prompt === expected.prompt &&
      scene.enhancedPrompt === expected.enhancedPrompt &&
      scene.visualNote === expected.visualNote &&
      scene.dialogue === expected.dialogue &&
      scene.mood === expected.mood &&
      scene.cameraMove === expected.cameraMove &&
      scene.musicMood === expected.musicMood &&
      scene.duration === expected.duration &&
      scene.transition === expected.transition &&
      scene.imageUrl === expected.imageUrl &&
      scene.videoUrl === expected.videoUrl;
  });
}

export interface ProjectAuthResult {
  ok: true;
  session: AuthSession;
  project: { id: string; userId: string | null; title: string };
}

export async function requireProjectAccess(projectId: string, writeCheck = false): Promise<ProjectAuthResult | AuthError> {
  const project = await db.videoProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      userId: true,
      title: true,
      description: true,
      style: true,
      aspectRatio: true,
      targetDuration: true,
      projectType: true,
      finalVideoUrl: true,
    },
  });
  if (!project) return { ok: false, response: NextResponse.json({ success: false, error: "Project not found" }, { status: 404 }) };

  if (project.userId === null) {
    if (!writeCheck) {
      return { ok: true, session: { userId: "guest", role: "guest", email: "" }, project };
    }

    // Check the real session before deciding whether an ownerless project may
    // transition into an authenticated project. This preserves anonymous demo
    // read access while keeping every write behind a valid active session.
    const authResult = await requireAuth();
    if (!authResult.ok) return authResult;

    const pristineDemo = await isPristineAnonymousDemo(project);
    const adminLegacyRecovery = !pristineDemo && authResult.session.role === "admin";

    // Ordinary users may claim only a shipped pristine demo. A non-demo
    // ownerless row can represent historical/imported data or a project whose
    // former owner was removed via onDelete:SetNull, so only an authenticated
    // administrator may recover it by explicitly attempting a write action.
    if (!pristineDemo && !adminLegacyRecovery) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: "This ownerless project cannot be modified." },
          { status: 403 },
        ),
      };
    }

    // The ownership transition is atomic. If two authenticated sessions race,
    // exactly one may change userId from null. A retry by the winning account
    // is accepted; every other account remains forbidden.
    const claimed = await db.videoProject.updateMany({
      where: { id: project.id, userId: null },
      data: { userId: authResult.session.userId },
    });
    if (claimed.count === 1) {
      if (adminLegacyRecovery) {
        console.warn(
          `[project-auth] admin recovered ownerless project project=${project.id} user=${authResult.session.userId}`,
        );
      }
      return {
        ok: true,
        session: authResult.session,
        project: { ...project, userId: authResult.session.userId },
      };
    }

    const latest = await db.videoProject.findUnique({
      where: { id: project.id },
      select: { userId: true },
    });
    if (latest?.userId === authResult.session.userId) {
      return {
        ok: true,
        session: authResult.session,
        project: { ...project, userId: authResult.session.userId },
      };
    }

    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "This ownerless project is already attached to another account." },
        { status: 409 },
      ),
    };
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
