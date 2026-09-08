import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  generatedStoreDir,
  promoteGeneratedFile,
} from "../../src/lib/generated-store";

describe("generated output promotion", () => {
  test("moves a completed render into the generated store without a Buffer copy", async () => {
    const store = generatedStoreDir();
    await mkdir(store, { recursive: true });
    const work = await mkdtemp(path.join(store, "promotion-test-"));
    const source = path.join(work, "render.mp4");
    const relPath = `promotion-test-${process.pid}-${Date.now()}.mp4`;
    let promotedPath = path.join(store, relPath);

    try {
      await writeFile(source, Buffer.from("completed-render"));
      const promoted = await promoteGeneratedFile(source, relPath);
      promotedPath = promoted.path;

      expect(promoted.url).toBe(`/generated/${relPath}`);
      expect(promoted.path).toBe(path.join(store, relPath));
      expect(existsSync(source)).toBe(false);
      expect((await readFile(promoted.path)).toString()).toBe("completed-render");
    } finally {
      await rm(work, { recursive: true, force: true });
      await rm(promotedPath, { force: true });
    }
  });

  test("wires every completed-video path through promoteGeneratedFile", () => {
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
