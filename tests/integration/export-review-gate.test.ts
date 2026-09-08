import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";

const createdUsers: string[] = [];

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
  test("allows preview jobs before review, blocks final export, freezes active cuts, and invalidates review after mutation", async () => {
    const { user, project, scene } = await createProjectWithClip();

    const afterSceneCreate = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(afterSceneCreate.cutVersion).toBeGreaterThan(0);
    expect(afterSceneCreate.reviewedCutVersion).toBeNull();

    // Full Preview itself must be allowed to queue before the cut is reviewed.
    // It is the job that creates the reviewable media. The activeKey still
    // freezes the cut while this preview is queued/running.
    const previewJob = await db.exportJob.create({
      data: {
        projectId: project.id,
        userId: user.id,
        activeKey: `project:${project.id}`,
        params: JSON.stringify({ mode: "preview", expectedCutVersion: afterSceneCreate.cutVersion }),
      },
    });

    await expectDatabaseGuard(
      () => db.videoScene.update({
        where: { id: scene.id },
        data: { videoUrl: "/generated/review-preview-race.mp4" },
      }),
      "VIDORA_EXPORT_ACTIVE",
    );

    await db.exportJob.update({
      where: { id: previewJob.id },
      data: { status: "done", activeKey: null },
    });

    // Direct POST /api/export-video ultimately creates a final-mode row. The
    // database must reject it even if a caller bypasses browser preview state.
    await expectDatabaseGuard(
      () => db.exportJob.create({
        data: {
          projectId: project.id,
          userId: user.id,
          activeKey: `project:${project.id}`,
          params: JSON.stringify({ mode: "final" }),
        },
      }),
      "VIDORA_PREVIEW_REQUIRED",
    );

    // Legacy/malformed params are fail-closed and must also be treated as final.
    await expectDatabaseGuard(
      () => db.exportJob.create({
        data: {
          projectId: project.id,
          userId: user.id,
          params: "not-json",
        },
      }),
      "VIDORA_PREVIEW_REQUIRED",
    );

    await db.videoProject.update({
      where: { id: project.id },
      data: {
        reviewedCutVersion: afterSceneCreate.cutVersion,
        reviewedAt: new Date(),
      },
    });

    const job = await db.exportJob.create({
      data: {
        projectId: project.id,
        userId: user.id,
        activeKey: `project:${project.id}`,
        params: JSON.stringify({ mode: "final" }),
      },
    });

    // Once a reviewed export is queued/running, a second tab cannot swap the
    // clip underneath the background worker.
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

    // Legacy/direct concatenate paths write finalVideoUrl without ExportJob.
    // The final-video trigger closes that alternate bypass as well.
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
      },
    });

    const finalized = await db.videoProject.update({
      where: { id: project.id },
      data: { finalVideoUrl: "/generated/final-reviewed.mp4", status: "completed" },
    });
    expect(finalized.finalVideoUrl).toBe("/generated/final-reviewed.mp4");
  });
});
