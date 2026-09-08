import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import { reviewCutProjectId } from "../../src/lib/review-cut-media";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Full Preview generated media names", () => {
  test("extracts project id from current versioned preview filenames", () => {
    expect(
      reviewCutProjectId("preview_cmg123abc_7_1788865080123.mp4"),
    ).toBe("cmg123abc");
    expect(
      reviewCutProjectId("preview_project-with_under_score_12_1788865080123.mp4"),
    ).toBe("project-with_under_score");
  });

  test("keeps legacy preview filenames readable", () => {
    expect(reviewCutProjectId("preview_cmg123abc.mp4")).toBe("cmg123abc");
  });

  test("rejects nested, non-mp4, and unsafe-looking generated paths", () => {
    expect(reviewCutProjectId("folder/preview_cmg123abc_7_1788865080123.mp4")).toBeNull();
    expect(reviewCutProjectId("preview_cmg123abc_7_1788865080123.webm")).toBeNull();
    expect(reviewCutProjectId("preview_../../secret.mp4")).toBeNull();
    expect(reviewCutProjectId("preview_.mp4")).toBeNull();
  });

  test("generated media route authorizes versioned review cuts through project access", () => {
    const route = source("src/app/generated/[...path]/route.ts");
    expect(route).toContain('import { reviewCutProjectId } from "@/lib/review-cut-media"');
    expect(route).toContain("const reviewProjectId = reviewCutProjectId(rel)");
    expect(route).toContain("requireProjectAccess(reviewProjectId, false)");
  });
});
