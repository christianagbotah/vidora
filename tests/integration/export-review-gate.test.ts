import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";

const createdUsers: string[] = [];
const DEFAULT_RENDER = {
  transition: "fade",
  withTitleCard: false,
  includeAudio: true,
} as const;

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function expectDatabaseGuard(
  operation: () => Promise<unknown>,
  marker: "VIDORA_PREVIEW_REQUIRED" | "VIDORA_EXPORT_ACTIVE",
): Promise<void> {
  let thrown: unknown = null;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).not.toBeNull();
  expect(errorText(thrown)).toContain(marker);
}

async function createProjectWithClip() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await db.user.create({
    data: {
      email: `export-review-${nonce}@example.invalid`,
      name: "Export Review Gate Test",
    },
  });
  createdUsers.push(user.id);

  const project = await db.videoProject.create({
    data: { userId: user.id, title: "Reviewed export invariant" },
  });
  const scene = await db.videoScene.create({
    data: {
      projectId: project.id,
      sceneNumber: 1,
      prompt: "A completed scene",
      videoUrl: "/generated/review-v1.mp4",
      status: "completed",
    },
  });

  return { user, project, scene };
}

afterAll(async () => {
  for (const id of createdUsers) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

describe("server-enforced full-video review gate", () => {
  test("binds export to reviewed cut and content config, freezes active export, and invalidates review after mutation", async () => {
    const { user, project, scene } = await createProjectWithClip();

    const afterSceneCreate = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(afterSceneCreate.cutVersion).toBeGreaterThan(0);
    expect(afterSceneCreate.reviewedCutVersion).toBeNull();
    expect(afterSceneCreate.reviewedRenderConfig).toBeNull();

    await expectDatabaseGuard(
      () => db.exportJob.create({
        data: {
          projectId: project.id,
          userId: user.id,
          activeKey: `project:${project.id}`,
          params: JSON.stringify(DEFAULT_RENDER),
        },
      }),
      "VIDORA_PREVIEW_REQUIRED",
    );

    await db.videoProject.update({
      where: { id: project.id },
      data: {
        reviewedCutVersion: afterSceneCreate.cutVersion,
        reviewedAt: new Date(),
        reviewedRenderConfig: DEFAULT_RENDER,
      },
    });

    // Same visual/audio cut but a different transition is materially different
    // content and must require a new preview before a durable job can exist.
    await expectDatabaseGuard(
      () => db.exportJob.create({
        data: {
          projectId: project.id,
          userId: user.id,
          activeKey: `project:${project.id}`,
          params: JSON.stringify({ ...DEFAULT_RENDER, transition: "slide" }),
        },
      }),
      "VIDORA_PREVIEW_REQUIRED",
    );

    const job = await db.exportJob.create({
      data: {
        projectId: project.id,
        userId: user.id,
        activeKey: `project:${project.id}`,
        params: JSON.stringify({
          quality: "ultra", // encoding-only differences remain allowed
          format: "webm",
          ...DEFAULT_RENDER,
        }),
      },
    });

    await expectDatabaseGuard(
      () => db.videoScene.update({
        where: { id: scene.id },
        data: { videoUrl: "/generated/review-v2.mp4" },
      }),
      "VIDORA_EXPORT_ACTIVE",
    );

    await db.exportJob.update({
      where: { id: job.id },
      data: { status: "done", activeKey: null },
    });

    await db.videoScene.update({
      where: { id: scene.id },
      data: { videoUrl: "/generated/review-v2.mp4" },
    });

    const afterCutChange = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(afterCutChange.cutVersion).toBeGreaterThan(afterSceneCreate.cutVersion);
    expect(afterCutChange.reviewedCutVersion).toBeNull();
    expect(afterCutChange.reviewedAt).toBeNull();
    expect(afterCutChange.reviewedRenderConfig).toBeNull();

    await expectDatabaseGuard(
      () => db.videoProject.update({
        where: { id: project.id },
        data: { finalVideoUrl: "/generated/final-stale.mp4", status: "completed" },
      }),
      "VIDORA_PREVIEW_REQUIRED",
    );

    await db.videoProject.update({
      where: { id: project.id },
      data: {
        reviewedCutVersion: afterCutChange.cutVersion,
        reviewedAt: new Date(),
        reviewedRenderConfig: DEFAULT_RENDER,
      },
    });

    const finalized = await db.videoProject.update({
      where: { id: project.id },
      data: { finalVideoUrl: "/generated/final-reviewed.mp4", status: "completed" },
    });
    expect(finalized.finalVideoUrl).toBe("/generated/final-reviewed.mp4");
  });

  test("changing project title invalidates the reviewed render configuration", async () => {
    const { project } = await createProjectWithClip();
    const current = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    await db.videoProject.update({
      where: { id: project.id },
      data: {
        reviewedCutVersion: current.cutVersion,
        reviewedAt: new Date(),
        reviewedRenderConfig: DEFAULT_RENDER,
      },
    });

    await db.videoProject.update({
      where: { id: project.id },
      data: { title: "A different reviewed title" },
    });
    const changed = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(changed.cutVersion).toBeGreaterThan(current.cutVersion);
    expect(changed.reviewedCutVersion).toBeNull();
    expect(changed.reviewedRenderConfig).toBeNull();
  });
});