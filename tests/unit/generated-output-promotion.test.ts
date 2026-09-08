import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";

const originalGeneratedDir = process.env.GENERATED_DIR;
const tempRoots: string[] = [];

afterEach(async () => {
  if (originalGeneratedDir === undefined) delete process.env.GENERATED_DIR;
  else process.env.GENERATED_DIR = originalGeneratedDir;
  vi.resetModules();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("generated output promotion", () => {
  it("moves a completed render into the generated store without a Buffer copy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vidora-promote-"));
    tempRoots.push(root);
    const store = path.join(root, "store");
    const work = path.join(store, "work");
    await mkdir(work, { recursive: true });
    const source = path.join(work, "render.mp4");
    await writeFile(source, Buffer.from("completed-render"));

    process.env.GENERATED_DIR = store;
    vi.resetModules();
    const { promoteGeneratedFile } = await import("../../src/lib/generated-store");
    const promoted = await promoteGeneratedFile(source, "final_project_123.mp4");

    expect(promoted.url).toBe("/generated/final_project_123.mp4");
    expect(promoted.path).toBe(path.join(store, "final_project_123.mp4"));
    expect(existsSync(source)).toBe(false);
    expect((await readFile(promoted.path)).toString()).toBe("completed-render");
  });

  it("wires every completed-video path through promoteGeneratedFile", () => {
    const preview = readFileSync("src/lib/full-preview-render.ts", "utf8");
    const exporter = readFileSync("src/app/api/export-video/route-core.ts", "utf8");
    const legacy = readFileSync("src/app/api/concatenate-video/route.ts", "utf8");
    const store = readFileSync("src/lib/generated-store.ts", "utf8");

    expect(preview).toContain("await promoteGeneratedFile(");
    expect(exporter.match(/await promoteGeneratedFile\(/g)?.length).toBe(2);
    expect(legacy).toContain("await promoteGeneratedFile(");
    expect(preview).not.toContain("readFile(outputPath)");
    expect(exporter).not.toContain("readFile(outputPath)");
    expect(exporter).not.toContain("finalData = await readFile");
    expect(legacy).not.toContain("readFile(outputPath)");
    expect(store).toContain("await rename(sourcePath, abs)");
    expect(store).toContain('if (code !== "EXDEV") throw error');
    expect(store).toContain("await copyFile(sourcePath, abs)");
    expect(store).toContain("await unlink(sourcePath)");
  });
});
