import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("create draft stale project id recovery", () => {
  test("missing remembered draft ids self-heal without weakening existing-project authorization", () => {
    const route = read("src/app/api/projects/draft/route.ts");

    expect(route).toContain("const existing = await db.videoProject.findUnique");
    expect(route).toContain("if (!existing) {");
    expect(route).toContain("projectId = null;");
    expect(route).toContain("const access = await requireProjectAccess(projectId, true)");
    expect(route).toContain('if (existing.status !== "draft")');
    expect(route).toContain("if (!projectId) {");
    expect(route).toContain("userId: auth.session.userId");
  });

  test("missing-id recovery no longer emits a 404 draft-not-found response from POST", () => {
    const route = read("src/app/api/projects/draft/route.ts");
    const postStart = route.indexOf("export async function POST");
    expect(postStart).toBeGreaterThan(-1);
    const post = route.slice(postStart);

    expect(post).not.toContain('error: "Project draft not found"');
    expect(post).not.toContain('status: 404');
  });
});
