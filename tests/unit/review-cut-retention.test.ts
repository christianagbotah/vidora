import { describe, expect, test } from "bun:test";
import {
  REVIEW_CUT_MIN_AGE_MS,
  REVIEW_CUT_MIN_KEEP,
  reviewCutFilesToPrune,
} from "../../src/lib/review-cut-retention";
import { reviewCutFileInfo } from "../../src/lib/review-cut-media";

function previewName(projectId: string, cutVersion: number, createdAtMs: number): string {
  return `preview_${projectId}_${cutVersion}_${createdAtMs}.mp4`;
}

describe("Full Preview retention", () => {
  test("parses current preview metadata without prefix-colliding project ids", () => {
    expect(reviewCutFileInfo("preview_team_alpha_12_1700000000000.mp4")).toEqual({
      projectId: "team_alpha",
      cutVersion: 12,
      createdAtMs: 1700000000000,
      legacy: false,
    });
    expect(reviewCutFileInfo("preview_team_alpha.mp4")).toEqual({
      projectId: "team_alpha",
      cutVersion: null,
      createdAtMs: null,
      legacy: true,
    });
  });

  test("keeps the newest previews even when every candidate is old", () => {
    const nowMs = 2_000_000_000_000;
    const names = Array.from({ length: REVIEW_CUT_MIN_KEEP + 3 }, (_, index) =>
      previewName(
        "project-a",
        index + 1,
        nowMs - REVIEW_CUT_MIN_AGE_MS - (index + 1) * 60_000,
      ),
    );

    const pruned = reviewCutFilesToPrune(names, "project-a", { nowMs });
    expect(pruned).toHaveLength(3);
    expect(pruned).toEqual(names.slice(REVIEW_CUT_MIN_KEEP));
  });

  test("keeps previews inside the 72-hour grace window even beyond the newest-count floor", () => {
    const nowMs = 2_000_000_000_000;
    const names = Array.from({ length: REVIEW_CUT_MIN_KEEP + 4 }, (_, index) =>
      previewName("project-a", index + 1, nowMs - (index + 1) * 60_000),
    );

    expect(reviewCutFilesToPrune(names, "project-a", { nowMs })).toEqual([]);
  });

  test("never prunes protected, legacy, other-project, malformed, or future-dated media", () => {
    const nowMs = 2_000_000_000_000;
    const old = Array.from({ length: REVIEW_CUT_MIN_KEEP + 3 }, (_, index) =>
      previewName(
        "project-a",
        index + 1,
        nowMs - REVIEW_CUT_MIN_AGE_MS - (index + 1) * 60_000,
      ),
    );
    const protectedName = old[REVIEW_CUT_MIN_KEEP + 1];
    const future = previewName("project-a", 99, nowMs + 10_000);
    const otherProject = previewName(
      "project-a-extra",
      1,
      nowMs - REVIEW_CUT_MIN_AGE_MS - 999_000,
    );
    const names = [
      ...old,
      "preview_project-a.mp4",
      future,
      otherProject,
      "preview_project-a_bad_timestamp.mp4",
      "final_project-a_1700000000000.mp4",
    ];

    const pruned = reviewCutFilesToPrune(names, "project-a", {
      nowMs,
      protectedUrls: [`/generated/${protectedName}`],
    });

    expect(pruned).not.toContain(protectedName);
    expect(pruned).not.toContain("preview_project-a.mp4");
    expect(pruned).not.toContain(future);
    expect(pruned).not.toContain(otherProject);
    expect(pruned).not.toContain("preview_project-a_bad_timestamp.mp4");
    expect(pruned).not.toContain("final_project-a_1700000000000.mp4");
    expect(pruned).toContain(old[REVIEW_CUT_MIN_KEEP]);
    expect(pruned).toContain(old[REVIEW_CUT_MIN_KEEP + 2]);
  });
});
