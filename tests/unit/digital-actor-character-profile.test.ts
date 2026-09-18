import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Digital Actor Character Profile reuse", () => {
  test("Photo Studio passes reusable profiles including saved voice metadata", () => {
    const page = read("src/app/photo-studio/page.tsx");
    expect(page).toContain("voiceId?: string | null");
    expect(page).toContain("<TalkingPhotoStudio images={assets} characters={profiles} />");
  });

  test("Talking Photo only surfaces consent-confirmed profiles with a primary portrait", () => {
    const component = read("src/components/TalkingPhotoStudio.tsx");
    expect(component).toContain('profile.consentStatus === "confirmed" && profile.primaryAsset');
    expect(component).toContain("Saved Digital Actors");
    expect(component).toContain("Consent confirmed");
    expect(component).not.toContain('profile.consentStatus !== "confirmed"');
  });

  test("selecting a saved actor restores portrait, voice and performance direction", () => {
    const component = read("src/components/TalkingPhotoStudio.tsx");
    expect(component).toContain("setSelectedCharacterId(profile.id)");
    expect(component).toContain("setSelectedImageId(profile.primaryAsset.id)");
    expect(component).toContain("DIGITAL_ACTOR_VOICES.has(savedVoice)");
    expect(component).toContain('setSpeechVoice(DIGITAL_ACTOR_VOICES.has(savedVoice) ? savedVoice : "tongtong")');
    expect(component).toContain("setSpeechStyle(digitalActorSpeechStyle(profile.performanceProfile))");
    expect(component).toContain("actingStyle");
    expect(component).toContain("gestureIntensity");
    expect(component).toContain("bodyMotion");
  });

  test("profile portraits remain selectable even when outside the recent media grid", () => {
    const component = read("src/components/TalkingPhotoStudio.tsx");
    expect(component).toContain("confirmedProfileHasImage");
    expect(component).toContain("profile.primaryAsset?.id === selectedImageId");
    expect(component).toContain("&& !confirmedProfileHasImage");
  });

  test("reusable character consent never replaces current paid-job confirmation", () => {
    const component = read("src/components/TalkingPhotoStudio.tsx");
    expect(component).toContain("setConsentConfirmed(false)");
    expect(component).toContain("resetPaidState()");
    expect(component).toContain("Current lip-sync still requires explicit confirmation below.");
    expect(component).toContain("consentConfirmed: true");
    expect(component).toContain("billingConfirmed: true");
  });

  test("manual portrait selection exits saved-actor mode", () => {
    const component = read("src/components/TalkingPhotoStudio.tsx");
    expect(component).toContain('setSelectedCharacterId("")');
    expect(component).toContain("const leavingSavedActor = Boolean(selectedCharacterId)");
    expect(component).toContain('setSpeechVoice("tongtong")');
    expect(component).toContain('setSpeechStyle("natural, warm and expressive")');
    expect(component).toContain("const selectImage = (id: string) => {");
  });
});
