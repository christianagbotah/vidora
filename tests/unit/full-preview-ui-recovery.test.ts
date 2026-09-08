import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("Full Preview UI recovery", () => {
  test("the studio renders the dedicated Full Preview review surface", () => {
    const page = source("src/app/page.tsx");
    expect(page).toContain('import { FullPreviewDialog } from "@/components/FullPreviewDialog"');
    expect(page).toContain("<FullPreviewDialog");
    expect(page).toContain("open={fullPreviewOpen}");
    expect(page).toContain("previewUrl={fullPreviewUrl}");
    expect(page).toContain("isRebuilding={isBuildingFullPreview}");
    expect(page).toContain("onRebuild={handleBuildFullPreview}");
    expect(page).toContain("setExportDialogOpen(true)");
  });

  test("the review surface reports media failures and offers retry plus rebuild", () => {
    const dialog = source("src/components/FullPreviewDialog.tsx");
    expect(dialog).toContain("onError={() => setMediaFailed(true)}");
    expect(dialog).toContain("onLoadedData={() => setMediaFailed(false)}");
    expect(dialog).toContain("Retry Loading");
    expect(dialog).toContain("Rebuild Preview");
    expect(dialog).toContain("Your project scenes are unchanged");
    expect(dialog).toContain("disabled={!previewUrl || mediaFailed || isRebuilding}");
  });
});
