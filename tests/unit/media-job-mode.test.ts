import { describe, expect, test } from "bun:test";
import { currentCutIsReviewed, mediaJobMode } from "../../src/lib/media-job-mode";

describe("media job mode trust boundary", () => {
  test("recognizes only an explicit preview mode", () => {
    expect(mediaJobMode(JSON.stringify({ mode: "preview" }))).toBe("preview");
    expect(mediaJobMode(JSON.stringify({ mode: "final" }))).toBe("final");
  });

  test("fails closed to final for missing, malformed, and unknown modes", () => {
    expect(mediaJobMode(null)).toBe("final");
    expect(mediaJobMode("not-json")).toBe("final");
    expect(mediaJobMode(JSON.stringify({}))).toBe("final");
    expect(mediaJobMode(JSON.stringify({ mode: "something-new" }))).toBe("final");
  });

  test("requires the reviewed cut to match the current cut exactly", () => {
    expect(currentCutIsReviewed({ cutVersion: 7, reviewedCutVersion: 7 })).toBe(true);
    expect(currentCutIsReviewed({ cutVersion: 7, reviewedCutVersion: 6 })).toBe(false);
    expect(currentCutIsReviewed({ cutVersion: 7, reviewedCutVersion: null })).toBe(false);
  });
});
