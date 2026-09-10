import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function source(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

describe("regeneration completion guard", () => {
  test("does not treat a preserved old video URL as completion of a queued replacement", () => {
    const worker = source("scripts", "generation-worker.ts");

    expect(worker).toContain('select: { id: true, status: true, videoUrl: true, dialogue: true, narrationUrl: true }');
    expect(worker).toContain('scene.status !== "completed" || !scene.videoUrl');
  });
});
