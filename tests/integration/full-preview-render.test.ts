import { afterAll, describe, expect, test } from "bun:test";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { db } from "@/lib/db";
import { generatedFilePath, generatedStoreDir } from "@/lib/generated-store";
import { renderFullProjectPreview } from "@/lib/full-preview-render";

const execFileAsync = promisify(execFile);
const createdUsers: string[] = [];
const createdFiles: string[] = [];

async function createClip(filename: string, frequency: number): Promise<string> {
  const output = generatedFilePath(filename);
  await mkdir(path.dirname(output), { recursive: true });
  await execFileAsync(
    "ffmpeg",
    [
      "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1.5:r=24",
      "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=1.5`,
      "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", output,
    ],
    { timeout: 30_000 },
  );
  createdFiles.push(output);
  return `/generated/${filename}`;
}

async function hasAudio(filePath: string): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", filePath],
    { timeout: 15_000 },
  );
  return stdout.trim().length > 0;
}

afterAll(async () => {
  for (const file of createdFiles) await rm(file, { force: true }).catch(() => undefined);
  for (const id of createdUsers) await db.user.delete({ where: { id } }).catch(() => undefined);
});

describe("assembled full-project preview", () => {
  test("renders real clip ambience and stays read-only for final project state", async () => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await db.user.create({
      data: { email: `preview-render-${nonce}@example.invalid`, name: "Preview Render Test" },
    });
    createdUsers.push(user.id);
    const project = await db.videoProject.create({
      data: { userId: user.id, title: "Preview must not finalize me" },
    });

    const clipOne = await createClip(`preview-test-${nonce}-1.mp4`, 440);
    const clipTwo = await createClip(`preview-test-${nonce}-2.mp4`, 660);
    await db.videoScene.createMany({
      data: [
        { projectId: project.id, sceneNumber: 1, prompt: "Scene one", videoUrl: clipOne, status: "completed" },
        { projectId: project.id, sceneNumber: 2, prompt: "Scene two", videoUrl: clipTwo, status: "completed" },
      ],
    });

    const before = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    const result = await renderFullProjectPreview(project.id, before.cutVersion, {
      transition: "fade",
      includeAudio: true,
      withTitleCard: false,
    });

    expect(result.sceneCount).toBe(2);
    expect(result.ambienceScenes).toBe(2);
    expect(result.includeAudio).toBe(true);
    expect(result.previewVideoUrl.startsWith("/generated/preview_")).toBe(true);

    const previewName = result.previewVideoUrl.replace(/^\/generated\//, "");
    const previewPath = generatedFilePath(previewName);
    createdFiles.push(previewPath);
    expect(existsSync(previewPath)).toBe(true);
    expect(await hasAudio(previewPath)).toBe(true);

    const after = await db.videoProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(after.cutVersion).toBe(before.cutVersion);
    expect(after.finalVideoUrl).toBeNull();
    expect(after.status).toBe(before.status);
  });
});
