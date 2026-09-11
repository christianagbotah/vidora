import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "../..");
const authSource = readFileSync(path.join(ROOT, "src/lib/project-auth.ts"), "utf8");
const demoSource = readFileSync(path.join(ROOT, "src/lib/demo-templates.ts"), "utf8");

describe("signed-in anonymous demo ownership transition", () => {
  test("recognizes only shipped pristine demo identity before a normal-user write claim", () => {
    expect(authSource).toContain('import { DEMO_TEMPLATES, getDemoFinalVideo } from "@/lib/demo-templates"');
    expect(authSource).toContain("async function isPristineAnonymousDemo");
    expect(authSource).toContain("template.title === project.title");
    expect(authSource).toContain("template.description === project.description");
    expect(authSource).toContain("getDemoFinalVideo(template.id) === project.finalVideoUrl");
    expect(authSource).toContain("scenes.length !== template.scenes.length");
    expect(authSource).toContain("scene.prompt === expected.prompt");
    expect(authSource).toContain("scene.videoUrl === expected.videoUrl");
    expect(demoSource).toContain('description: "[DEMO]');
  });

  test("requires a valid session before atomically claiming an ownerless project", () => {
    const ownerlessBlock = authSource.indexOf("if (project.userId === null)");
    const authCheck = authSource.indexOf("const authResult = await requireAuth();", ownerlessBlock);
    const pristineCheck = authSource.indexOf("await isPristineAnonymousDemo(project)", ownerlessBlock);
    const atomicClaim = authSource.indexOf("const claimed = await db.videoProject.updateMany", ownerlessBlock);

    expect(ownerlessBlock).toBeGreaterThan(-1);
    expect(authCheck).toBeGreaterThan(ownerlessBlock);
    expect(pristineCheck).toBeGreaterThan(authCheck);
    expect(atomicClaim).toBeGreaterThan(pristineCheck);
    expect(authSource.slice(atomicClaim, atomicClaim + 300)).toContain("userId: null");
    expect(authSource.slice(atomicClaim, atomicClaim + 300)).toContain("userId: authResult.session.userId");
  });

  test("allows only admins to recover non-demo ownerless legacy projects", () => {
    expect(authSource).toContain('const adminLegacyRecovery = !pristineDemo && authResult.session.role === "admin"');
    expect(authSource).toContain("if (!pristineDemo && !adminLegacyRecovery)");
    expect(authSource).toContain('error: "This ownerless project cannot be modified."');
    expect(authSource).toContain("admin recovered ownerless project");
  });

  test("resolves ownership claim races without allowing a second account", () => {
    expect(authSource).toContain("if (claimed.count === 1)");
    expect(authSource).toContain("latest?.userId === authResult.session.userId");
    expect(authSource).toContain('error: "This ownerless project is already attached to another account."');
  });
});
