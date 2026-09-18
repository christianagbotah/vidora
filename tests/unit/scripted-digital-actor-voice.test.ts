import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import {
  normalizeTalkingPhotoSpeechSpec,
  talkingPhotoSpeechChunks,
  talkingPhotoSpeechFingerprint,
  TALKING_PHOTO_SPEECH_MAX_CHARS,
} from "../../src/lib/talking-photo-speech-billing";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("Scripted Digital Actor voice", () => {
  test("normalizes a bounded single-speaker script deterministically", () => {
    const spec = normalizeTalkingPhotoSpeechSpec({
      script: "  Hello   from Vidora.  ",
      voice: " TongTong ",
      language: " en ",
      accent: " Ghanaian ",
      style: " warm   and calm ",
    });
    expect(spec).toEqual({
      script: "Hello from Vidora.",
      voice: "tongtong",
      language: "en",
      accent: "Ghanaian",
      style: "warm and calm",
    });
    expect(talkingPhotoSpeechChunks(spec.script)).toEqual(["Hello from Vidora."]);
    expect(talkingPhotoSpeechFingerprint(spec, "qwen3-tts-instruct-flash")).toHaveLength(64);
    expect(TALKING_PHOTO_SPEECH_MAX_CHARS).toBe(3500);
    expect(() => normalizeTalkingPhotoSpeechSpec({ script: "x".repeat(3501) })).toThrow();
  });

  test("voice quote is exact Qwen Billing v2 pricing and does not reserve or call a provider", () => {
    const billing = read("src/lib/talking-photo-speech-billing.ts");
    const route = read("src/app/api/photo-studio/talking-photo/speech/quote/route.ts");
    expect(billing).toContain('provider: "qwen"');
    expect(billing).toContain('operation: "tts"');
    expect(billing).toContain("quantity");
    expect(billing).toContain("createBillingQuote");
    expect(billing).toContain('getConfigValue("qwen_tts_api_key", "DASHSCOPE_API_KEY")');
    expect(route).toContain("createTalkingPhotoSpeechQuote");
    expect(route).not.toContain("reserveBillingQuote");
    expect(route).not.toContain("synthesizeQwenTts");
    expect(route).not.toContain("submitFalTalkingPhoto");
  });

  test("start route revalidates exact script scope before reserving once", () => {
    const route = read("src/app/api/photo-studio/talking-photo/speech/jobs/route.ts");
    const match = route.indexOf("requireMatchingTalkingPhotoSpeechQuote({");
    const reserve = route.indexOf("await reserveBillingQuote({");
    expect(match).toBeGreaterThan(0);
    expect(reserve).toBeGreaterThan(match);
    expect(route).toContain("body.billingConfirmed !== true");
    expect(route).toContain("talking-photo-speech-job:");
    expect(route).toContain('status: "reserving"');
    expect(route).toContain('status: "queued"');
    expect(route).toContain("releaseReservationRemainder");
    expect(route).toContain('status: "completed"');
    expect(route).toContain("reused without another charge");
    expect(route).toContain("db.mediaAsset.findFirst");
    expect(route).toContain('kind: "audio"');
    expect(route).not.toContain("synthesizeQwenTts");
    expect(route).not.toContain("submitFalTalkingPhoto");
  });

  test("worker captures each prepaid line immediately before the one Qwen call", () => {
    const execution = read("src/lib/talking-photo-speech-execution.ts");
    const capture = execution.indexOf("const capture = await captureReservedQuoteLine({");
    const replayGuard = execution.indexOf("if (capture.alreadyCaptured)");
    const provider = execution.indexOf("speech = await synthesizeQwenTts({");
    const artifact = execution.indexOf("writeAudioFile(filename, speech.buffer)");
    expect(capture).toBeGreaterThan(0);
    expect(replayGuard).toBeGreaterThan(capture);
    expect(provider).toBeGreaterThan(replayGuard);
    expect(artifact).toBeGreaterThan(provider);
    expect(execution).toContain("Automatic Qwen resubmission is blocked");
    expect(execution).toContain('status: "needs_reconciliation"');
    expect(execution).not.toContain("submitFalTalkingPhoto");
  });

  test("completed Qwen speech becomes a private measured MediaAsset for the separate lip-sync quote", () => {
    const execution = read("src/lib/talking-photo-speech-execution.ts");
    expect(execution).toContain("probeTalkingPhotoAudio(buffer)");
    expect(execution).toContain("saveGeneratedFile(");
    expect(execution).toContain('kind: "audio"');
    expect(execution).toContain('source: "qwen_tts"');
    expect(execution).toContain("durationSeconds: probe.durationSeconds");
    expect(execution).toContain("outputAssetId");
    expect(execution).not.toContain("} finally {");
    expect(execution.indexOf('status: "completed"')).toBeLessThan(execution.lastIndexOf("deleteAudioFile(outputName)"));
  });

  test("existing Talking Photo worker processes speech jobs without another PM2 daemon", () => {
    const worker = read("scripts/talking-photo-worker.ts");
    const ecosystem = read("ecosystem.config.js");
    expect(worker).toContain("recoverStaleTalkingPhotoSpeechReservations");
    expect(worker).toContain("claimTalkingPhotoSpeechJob");
    expect(worker).toContain("runTalkingPhotoSpeechJob");
    expect(worker).toContain("speechJobId = null;");
    expect(worker.indexOf("runTalkingPhotoSpeechJob(speechJobId)")).toBeLessThan(worker.indexOf("jobId = await claimJob()"));
    expect(ecosystem).toContain('name: "vidora-talking-photo-worker"');
    expect(ecosystem).not.toContain("vidora-talking-photo-speech-worker");
  });

  test("UI visibly keeps voice billing separate from lip-sync billing", () => {
    const component = read("src/components/TalkingPhotoStudio.tsx");
    expect(component).toContain("Scripted Digital Actor");
    expect(component).toContain("Two-stage billing");
    expect(component).toContain("/api/photo-studio/talking-photo/speech/quote");
    expect(component).toContain("/api/photo-studio/talking-photo/speech/jobs");
    expect(component).toContain("Review voice cost");
    expect(component).toContain("Lip-sync is priced separately afterward");
    expect(component).toContain("/api/photo-studio/talking-photo/quote");
    expect(component).toContain("Review cost");
  });

  test("admin reconciliation releases only unused voice reservation remainder", () => {
    const route = read("src/app/api/admin/talking-photo/reconciliation/route.ts");
    const page = read("src/app/admin/talking-photo/reconciliation/page.tsx");
    expect(route).toContain('"close_speech_release_remainder"');
    expect(route).toContain('jobType === "speech"');
    expect(route).toContain("releaseReservationRemainder({");
    expect(route).toContain("captured Qwen lines remain billable");
    expect(route).toContain("capturedCreditsPreserved: reservation.capturedCredits");
    expect(route).toContain('status: "failed"');
    expect(route).toContain("activeKey: null");
    expect(page).toContain("Digital Actor voice reconciliation");
    expect(page).toContain("Close voice job & release unused credits");
    expect(page).toContain("Already-captured Qwen credits are not refunded");
  });

  test("migration and runtime contract enforce durable speech queue locks", () => {
    const migration = read("prisma/migrations/20260918171000_scripted_digital_actor_speech/migration.sql");
    const runtime = read("scripts/check-runtime-db-contract.ts");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "TalkingPhotoSpeechJob"');
    expect(migration).toContain('"TalkingPhotoSpeechJob_activeKey_key"');
    expect(runtime).toContain("TalkingPhotoSpeechJob table is missing");
    expect(runtime).toContain("TalkingPhotoSpeechJob.activeKey must be unique");
    expect(runtime).toContain("TalkingPhotoSpeechJob_status_updatedAt_idx");
  });
});
