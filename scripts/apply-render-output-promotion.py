from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected exactly one match, found {count}: {old[:120]!r}"
        )
    p.write_text(text.replace(old, new, 1))


replace_once(
    "src/lib/generated-store.ts",
    'import { mkdir, writeFile, readFile, stat } from "fs/promises";',
    'import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";',
)
replace_once(
    "src/lib/generated-store.ts",
    """export function generatedStoreDir(): string {
  return STORE_DIR;
}
""",
    """export function generatedStoreDir(): string {
  return STORE_DIR;
}

/**
 * Promote an already-rendered file into the persistent generated store without
 * buffering the complete media file in JavaScript memory. Render workdirs are
 * normally inside this store, so rename is an atomic metadata operation. The
 * EXDEV fallback covers future callers whose source lives on another filesystem.
 */
export async function promoteGeneratedFile(
  sourcePath: string,
  relPath: string,
): Promise<{ path: string; url: string }> {
  const safe = sanitizeRelPath(relPath);
  const abs = path.join(STORE_DIR, safe);
  await mkdir(path.dirname(abs), { recursive: true });

  if (path.resolve(sourcePath) !== path.resolve(abs)) {
    try {
      await rename(sourcePath, abs);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (code !== "EXDEV") throw error;
      await copyFile(sourcePath, abs);
      await unlink(sourcePath);
    }
  }

  return { path: abs, url: `/generated/${safe}` };
}
""",
)

replace_once(
    "src/lib/full-preview-render.ts",
    'import { mkdir, readFile, rm, writeFile } from "fs/promises";',
    'import { mkdir, rm, writeFile } from "fs/promises";',
)
replace_once(
    "src/lib/full-preview-render.ts",
    'import { generatedFilePath, generatedStoreDir, resolvePublicAssetPath } from "@/lib/generated-store";',
    'import { generatedStoreDir, promoteGeneratedFile, resolvePublicAssetPath } from "@/lib/generated-store";',
)
replace_once(
    "src/lib/full-preview-render.ts",
    """    const outputName = `preview_${projectId}_${expectedCutVersion}_${Date.now()}.mp4`;
    const persistentPath = generatedFilePath(outputName);
    await mkdir(path.dirname(persistentPath), { recursive: true });
    await writeFile(persistentPath, await readFile(outputPath));
    return {
      previewVideoUrl: `/generated/${outputName}`,""",
    """    const outputName = `preview_${projectId}_${expectedCutVersion}_${Date.now()}.mp4`;
    const { path: persistentPath, url: previewVideoUrl } = await promoteGeneratedFile(
      outputPath,
      outputName,
    );
    return {
      previewVideoUrl,""",
)

replace_once(
    "src/app/api/export-video/route-core.ts",
    'import { generatedStoreDir, generatedFilePath, resolvePublicAssetPath } from "@/lib/generated-store";',
    'import { generatedStoreDir, promoteGeneratedFile, resolvePublicAssetPath } from "@/lib/generated-store";',
)
replace_once(
    "src/app/api/export-video/route-core.ts",
    'import { writeFile, mkdir, rm, readFile } from "fs/promises";',
    'import { writeFile, mkdir, rm } from "fs/promises";',
)
replace_once(
    "src/app/api/export-video/route-core.ts",
    """    // Copy final to the persistent generated store
    await onProgress(94, "Saving final video…");
    const finalPath = generatedFilePath(outputFileName);
    const finalData = await readFile(outputPath);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await writeFile(finalPath, finalData);

    const finalVideoUrl = `/generated/${outputFileName}`;
    const fileSize = statSync(finalPath).size;
    const outputDuration = await getVideoDuration(outputPath);""",
    """    // Promote the completed render without loading the MP4/WebM into JS memory.
    await onProgress(94, "Saving final video…");
    const { path: finalPath, url: finalVideoUrl } = await promoteGeneratedFile(
      outputPath,
      outputFileName,
    );
    const fileSize = statSync(finalPath).size;
    const outputDuration = await getVideoDuration(finalPath);""",
)
replace_once(
    "src/app/api/export-video/route-core.ts",
    """    // ── Step 7: Copy to the persistent generated store ───────────────
    await onProgress(94, "Saving final video…");
    const finalPath = generatedFilePath(outputFileName);
    const finalData = await readFile(outputPath);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await writeFile(finalPath, finalData);

    const finalVideoUrl = `/generated/${outputFileName}`;

    // ── Step 8: Gather output stats ──────────────────────────────────
    const fileSize = statSync(finalPath).size;
    const outputDuration = await getVideoDuration(outputPath);""",
    """    // ── Step 7: Promote to the persistent generated store ────────────
    await onProgress(94, "Saving final video…");
    const { path: finalPath, url: finalVideoUrl } = await promoteGeneratedFile(
      outputPath,
      outputFileName,
    );

    // ── Step 8: Gather output stats ──────────────────────────────────
    const fileSize = statSync(finalPath).size;
    const outputDuration = await getVideoDuration(finalPath);""",
)

replace_once(
    "src/app/api/concatenate-video/route.ts",
    """  generatedStoreDir,
  generatedFilePath,
  resolvePublicAssetPath,""",
    """  generatedStoreDir,
  promoteGeneratedFile,
  resolvePublicAssetPath,""",
)
replace_once(
    "src/app/api/concatenate-video/route.ts",
    'import { writeFile, mkdir, rm, readFile } from "fs/promises";',
    'import { writeFile, mkdir, rm } from "fs/promises";',
)
replace_once(
    "src/app/api/concatenate-video/route.ts",
    """      const resultFileName = `final_${projectId}.mp4`;
      const resultPath = generatedFilePath(resultFileName);
      await mkdir(path.dirname(resultPath), { recursive: true });
      await writeFile(resultPath, await readFile(outputPath));
      const resultVideoUrl = `/generated/${resultFileName}`;""",
    """      const resultFileName = `final_${projectId}.mp4`;
      const { url: resultVideoUrl } = await promoteGeneratedFile(
        outputPath,
        resultFileName,
      );""",
)

Path("tests/unit/generated-output-promotion.test.ts").write_text(
    r'''import { afterEach, describe, expect, it, vi } from "vitest";
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
'''
)

Path(".github/workflows/apply-render-output-promotion.yml").unlink(missing_ok=True)
Path(__file__).unlink(missing_ok=True)
