import { describe, expect, test } from "bun:test";
import { finalExportFileInfo } from "../../src/lib/final-export-media";
import {
  FINAL_EXPORT_MIN_AGE_MS,
  FINAL_EXPORT_MIN_KEEP,
  finalExportFilesToPrune,
} from "../../src/lib/final-export-retention";

function finalName(
  projectId: string,
  createdAtMs: number,
  extension: "mp4" | "webm" = "mp4",
): string {
  return `final_${projectId}_${createdAtMs}.${extension}`;
}

describe("final export retention", () => {
  test("parses current MP4/WebM exports and preserves legacy numeric project suffixes", () => {
    expect(finalExportFileInfo("final_team_alpha_1700000000000.mp4")).toEqual({
      projectId: "team_alpha",
      createdAtMs: 1700000000000,
      extension: "mp4",
      legacy: false,
    });
    expect(finalExportFileInfo("final_team_alpha_1700000000001.webm")).toEqual({
      projectId: "team_alpha",
      createdAtMs: 1700000000001,
      extension: "webm",
      legacy: false,
    });
    expect(finalExportFileInfo("final_team_alpha.mp4")).toEqual({
      projectId: "team_alpha",
      createdAtMs: null,
      extension: "mp4",
      legacy: true,
    });
    expect(finalExportFileInfo("final_team_alpha_123.mp4")).toEqual({
      projectId: "team_alpha_123",
      createdAtMs: null,
      extension: "mp4",
      legacy: true,
    });
  });

  test("keeps the newest ten final exports even when every candidate is old", () => {
    const nowMs = 2_000_000_000_000;
    const names = Array.from({ length: FINAL_EXPORT_MIN_KEEP + 3 }, (_, index) =>
      finalName(
        "project-a",
        nowMs - FINAL_EXPORT_MIN_AGE_MS - (index + 1) * 60_000,
        index % 2 === 0 ? "mp4" : "webm",
      ),
    );

    expect(finalExportFilesToPrune(names, "project-a", { nowMs }))
      .toEqual(names.slice(FINAL_EXPORT_MIN_KEEP));
  });

  test("keeps every export inside the 30-day grace window even beyond the count floor", () => {
    const nowMs = 2_000_000_000_000;
    const names = Array.from({ length: FINAL_EXPORT_MIN_KEEP + 5 }, (_, index) =>
      finalName("project-a", nowMs - (index + 1) * 60_000),
    );

    expect(finalExportFilesToPrune(names, "project-a", { nowMs })).toEqual([]);
  });

  test("never prunes protected current media, legacy files, prefix-colliding projects, malformed files, or future timestamps", () => {
    const nowMs = 2_000_000_000_000;
    const old = Array.from({ length: FINAL_EXPORT_MIN_KEEP + 4 }, (_, index) =>
      finalName(
        "project-a",
        nowMs - FINAL_EXPORT_MIN_AGE_MS - (index + 1) * 60_000,
      ),
    );
    const protectedName = old[FINAL_EXPORT_MIN_KEEP + 1];
    const otherProject = finalName(
      "project-a-extra",
      nowMs - FINAL_EXPORT_MIN_AGE_MS - 999_000,
    );
    const future = finalName("project-a", nowMs + 10_000);
    const names = [
      ...old,
      "final_project-a.mp4",
      "final_project-a_123.mp4",
      otherProject,
      future,
      "final_project-a_bad.webm",
      "final_project-a_1700000000000.mov",
      "preview_project-a_1_1700000000000.mp4",
    ];

    const pruned = finalExportFilesToPrune(names, "project-a", {
      nowMs,
      protectedUrls: [`/generated/${protectedName}`],
    });

    expect(pruned).not.toContain(protectedName);
    expect(pruned).not.toContain("final_project-a.mp4");
    expect(pruned).not.toContain("final_project-a_123.mp4");
    expect(pruned).not.toContain(otherProject);
    expect(pruned).not.toContain(future);
    expect(pruned).not.toContain("final_project-a_bad.webm");
    expect(pruned).not.toContain("final_project-a_1700000000000.mov");
    expect(pruned).not.toContain("preview_project-a_1_1700000000000.mp4");
    expect(pruned).toContain(old[FINAL_EXPORT_MIN_KEEP]);
    expect(pruned).toContain(old[FINAL_EXPORT_MIN_KEEP + 2]);
    expect(pruned).toContain(old[FINAL_EXPORT_MIN_KEEP + 3]);
  });
});
