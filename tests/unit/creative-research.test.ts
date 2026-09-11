import { describe, expect, test } from "bun:test";
import {
  augmentDirectorPromptWithResearch,
  buildCreativeResearchContext,
  enrichScenePayloadWithResearch,
  extractStrongResearchCandidates,
  type CreativeResearchDossier,
} from "@/lib/creative-research";

const dossier: CreativeResearchDossier = {
  generatedAt: "2026-09-11T00:00:00.000Z",
  totalCreditsCharged: 1,
  entities: [{
    name: "GHACEM",
    query: '"GHACEM" official information company organization products services person place visual identity',
    creditsCharged: 1,
    status: "researched",
    sources: [{
      title: "GHACEM official company profile",
      summary: "Ghana-based cement company information and product context.",
      url: "https://example.com/ghacem",
      siteName: "Example",
      iconUrl: null,
      publishDate: null,
    }],
  }],
};

describe("creative research entity detection", () => {
  test("detects strong brand signals without searching ordinary prose", () => {
    expect(extractStrongResearchCandidates("Create a premium commercial for GHACEM in Ghana.")).toContain("GHACEM");
    expect(extractStrongResearchCandidates("Create an advert for Nike with an energetic voice-over.")).toContain("Nike");
    expect(extractStrongResearchCandidates("A quiet family walks through a beautiful village at sunrise.")).toEqual([]);
  });

  test("does not web-search uppercase celebration text or a private honoree by default", () => {
    expect(extractStrongResearchCandidates("HAPPY BIRTHDAY GIANNIS! Everyone cheers as balloons rise.")).toEqual([]);
  });

  test("can detect an explicitly requested public-name research context", () => {
    expect(extractStrongResearchCandidates("Create a documentary about Kwame Nkrumah and Ghanaian independence.")).toContain("Kwame Nkrumah");
  });

  test("caps automatic paid research candidates", () => {
    const candidates = extractStrongResearchCandidates("Ads for GHACEM, MTN, GTP, BMW, ECG and GRA.");
    expect(candidates.length).toBeLessThanOrEqual(3);
  });
});

describe("creative research prompt grounding", () => {
  test("marks web material as untrusted and forbids invented exact logos", () => {
    const context = buildCreativeResearchContext(dossier);
    expect(context).toContain("UNTRUSTED REFERENCE DATA");
    expect(context).toContain("GHACEM");
    expect(context.toLowerCase()).toContain("do not");
    expect(context.toLowerCase()).toContain("exact official logo");
  });

  test("adds premium commercial grammar to commercial projects", () => {
    const directed = augmentDirectorPromptWithResearch({
      systemPrompt: "BASE DIRECTOR",
      userPrompt: "USER BRIEF",
      dossier,
      projectType: "commercial",
    });
    expect(directed.systemPrompt).toContain("PROFESSIONAL COMMERCIAL DIRECTION");
    expect(directed.systemPrompt).toContain("end-frame/CTA");
    expect(directed.systemPrompt).toContain("exact super text inside the Visual:");
    expect(directed.userPrompt).toContain("GHACEM");
  });

  test("enriches relevant structured scenes and returns the dossier", () => {
    const payload = enrichScenePayloadWithResearch({
      success: true,
      scenes: [{ prompt: "Hero shot of GHACEM cement bags at a construction site", dialogue: "" }],
    }, dossier, "commercial");
    const scenes = payload.scenes as Array<{ prompt: string }>;
    expect(scenes[0].prompt).toContain("Real-world entity reference — GHACEM");
    expect(payload.researchDossier).toEqual(dossier);
  });
});
