import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";

const createdUsers: string[] = [];

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function expectExportActiveGuard(operation: () => Promise<unknown>): Promise<void> {
  let thrown: unknown = null;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).not.toBeNull();
  expect(errorText(thrown)).toContain("VIDORA_EXPORT_ACTIVE");
}

async function markReviewed(projectId: string) {
  const project = await db.videoProject.findUniqueOrThrow({ where: { id: projectId } });
  return db.videoProject.update({
    where: { id: projectId },
    data: { reviewedCutVersion: project.cutVersion, reviewedAt: new Date() },
  });
}

afterAll(async () => {
  for (const id of createdUsers) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

describe("audio-aware project review invalidation", () => {
  test("dialogue, music, and character voice changes invalidate review while derived narration writes do not", async () => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await db.user.create({
      data: { email: `audio-review-${nonce}@example.invalid`, name: "Audio Review Test" },
    });
    createdUsers.push(user.id);

    const project = await db.videoProject.create({
      data: { userId: user.id, title: "Audio review invariant" },
    });
    const character = await db.character.create({
      data: {
        projectId: project.id,
        name: "Marshall",
        voiceId: "chuichui",
      },
    });
    const scene = await db.videoScene.create({
      data: {
        projectId: project.id,
        sceneNumber: 1,
        prompt: "A birthday scene",
        dialogue: "Marshall (excited): Happy birthday, Giannis!",
        characterIds: JSON.stringify([character.id]),
        narrationVoice: "tongtong",
        narrationUrl: "/api/audio/old-performance.wav",
        musicTrackUrl: "/generated/birthday-bed.mp3",
        musicVolume: 30,
        videoUrl: "/generated/birthday-scene.mp4",
        status: "completed",
      },
    });

    const reviewed = await markReviewed(project.id);
    const reviewedVersion = reviewed.cutVersion;

    // narrationUrl is a derived artifact. Persisting the deterministic audio
    // generated during preview/export must not invalidate the review itself.
    await db.videoScene.update({
      where: { id: scene.id },
      data: { narrationUrl: "/api/audio/current-performance.wav" },
    });
    const afterDerivedWrite = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(afterDerivedWrite.cutVersion).toBe(reviewedVersion);
    expect(afterDerivedWrite.reviewedCutVersion).toBe(reviewedVersion);

    await db.videoScene.update({
      where: { id: scene.id },
      data: { dialogue: "Marshall (warmly): Giannis, we hope you have an amazing birthday!" },
    });
    const afterDialogue = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(afterDialogue.cutVersion).toBeGreaterThan(reviewedVersion);
    expect(afterDialogue.reviewedCutVersion).toBeNull();
    expect(afterDialogue.reviewedAt).toBeNull();

    const reviewedAfterDialogue = await markReviewed(project.id);
    await db.videoScene.update({
      where: { id: scene.id },
      data: { musicVolume: 55 },
    });
    const afterMusic = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(afterMusic.cutVersion).toBeGreaterThan(reviewedAfterDialogue.cutVersion);
    expect(afterMusic.reviewedCutVersion).toBeNull();

    const reviewedAfterMusic = await markReviewed(project.id);
    await db.character.update({
      where: { id: character.id },
      data: { voiceId: "luodo" },
    });
    const afterVoice = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(afterVoice.cutVersion).toBeGreaterThan(reviewedAfterMusic.cutVersion);
    expect(afterVoice.reviewedCutVersion).toBeNull();

    await markReviewed(project.id);
    const job = await db.exportJob.create({
      data: {
        projectId: project.id,
        userId: user.id,
        activeKey: `project:${project.id}`,
        status: "queued",
      },
    });

    await expectExportActiveGuard(() => db.videoScene.update({
      where: { id: scene.id },
      data: { dialogue: "Marshall: A last-second line change." },
    }));
    await expectExportActiveGuard(() => db.character.update({
      where: { id: character.id },
      data: { voiceId: "jam" },
    }));

    await db.exportJob.update({
      where: { id: job.id },
      data: { status: "done", activeKey: null },
    });
  });
});
