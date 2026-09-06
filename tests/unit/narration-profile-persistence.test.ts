import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("scene narration profile persistence", () => {
  test("profile endpoint persists settings without invoking a provider or token billing", () => {
    const route = source("src/app/api/scenes/[id]/narration-profile/route.ts");
    expect(route).toContain("requireSceneAccess(sceneId, true)");
    expect(route).toContain("narrationLang: profile.language");
    expect(route).toContain("narrationUrl: null");
    expect(route).not.toContain("zai.");
    expect(route).not.toContain("deductTokensForOperation");
  });

  test("scene card persists language changes instead of keeping them only in React state", () => {
    const page = source("src/app/page.tsx");
    expect(page).toContain("/narration-profile");
    expect(page).toContain("handleNarrationLanguageChange");
    expect(page).not.toContain("onLanguageChange={setNarrationLanguage}");
  });
});
