import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import {
  probeTalkingPhotoAudio,
  TALKING_PHOTO_MAX_DURATION_SECONDS,
} from "../../src/lib/photo-studio-audio";
import { toSignedProviderMediaUrl } from "../../src/lib/provider-media-access";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

function silentWav(seconds = 1, sampleRate = 8_000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const dataBytes = samples * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataBytes, 40);
  return out;
}

describe("Talking Photo execution", () => {
  test("server probes real audio duration instead of trusting client metadata", async () => {
    const audio = await probeTalkingPhotoAudio(silentWav(1));
    expect(audio.extension).toBe("wav");
    expect(audio.mimeType).toBe("audio/wav");
    expect(audio.durationSeconds).toBeGreaterThan(0.9);
    expect(audio.durationSeconds).toBeLessThan(1.1);
    expect(TALKING_PHOTO_MAX_DURATION_SECONDS).toBe(600);
    await expect(probeTalkingPhotoAudio(Buffer.from("not audio"))).rejects.toThrow();
  });

  test("quote uses only account-owned image/audio assets and persisted measured duration", () => {
    const route = read("src/app/api/photo-studio/talking-photo/quote/route.ts");
    expect(route).toContain('userId: auth.session.userId, kind: "image"');
    expect(route).toContain('userId: auth.session.userId, kind: "audio"');
    expect(route).toContain("audio.durationSeconds");
    expect(route).toContain("createTalkingPhotoQuote");
    expect(route).not.toContain("body.durationSeconds");
    expect(route).toContain("assertFalTalkingPhotoConfigured");
  });

  test("job start requires both permission and explicit billing confirmation before reservation", () => {
    const route = read("src/app/api/photo-studio/talking-photo/jobs/route.ts");
    const reserve = route.indexOf("await reserveBillingQuote({");
    expect(route).toContain("body.consentConfirmed !== true");
    expect(route).toContain("body.billingConfirmed !== true");
    expect(route).toContain("requireMatchingTalkingPhotoQuote");
    expect(route).toContain("assertFalTalkingPhotoConfigured");
    expect(route).toContain('status: "reserving"');
    const quoteMatch = route.indexOf("requireMatchingTalkingPhotoQuote({");
    expect(quoteMatch).toBeGreaterThan(0);
    expect(reserve).toBeGreaterThan(quoteMatch);
    expect(route).not.toContain("submitFalTalkingPhoto");
  });

  test("worker records submitting before provider POST and request id before capture", () => {
    const worker = read("scripts/talking-photo-worker.ts");
    const submitting = worker.indexOf('status: "submitting"');
    const submitCall = worker.indexOf("submitFalTalkingPhoto({ imageUrl, audioUrl })");
    const persistTask = worker.indexOf("providerTaskId: submitted.requestId");
    const capture = worker.indexOf("captureReservedQuoteLine({");

    expect(submitting).toBeGreaterThan(0);
    expect(submitCall).toBeGreaterThan(submitting);
    expect(persistTask).toBeGreaterThan(submitCall);
    expect(capture).toBeGreaterThan(persistTask);
    expect(worker).toContain("recoverStaleReservations");
    expect(worker).toContain("findReservationByReference");
    expect(worker).toContain("Recovered stale Talking Photo reservation before any provider submission");
    expect(worker).toContain("quarantineAmbiguousSubmissions");
    expect(worker).toContain("needs_reconciliation");
    expect(worker).toContain("Automatic resubmission is blocked");
    expect(worker).toContain("providerDefinitelyNotSubmitted");
    expect(worker).toContain("ensureAcceptedJobCaptured");
    expect(worker).toContain("captureReservedQuoteLine");
    expect(worker).toContain('current?.status === "submitting"');
    expect(worker).toContain("automatic resubmission is blocked");
  });

  test("private image/audio source URLs use short-lived signed capabilities", () => {
    const previous = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "talking-photo-test-secret-that-is-long-enough";
    try {
      const signed = toSignedProviderMediaUrl(
        "/generated/users/user-1/photo-studio/audio/a.wav",
        "https://vidora.example",
      );
      expect(signed).toContain("https://vidora.example/generated/users/user-1/photo-studio/audio/a.wav");
      expect(signed).toContain("vpm_exp=");
      expect(signed).toContain("vpm_sig=");
      expect(toSignedProviderMediaUrl("/generated/a.wav", "http://vidora.example")).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = previous;
    }
  });

  test("completed Talking Photo media remains owner-authenticated", () => {
    const generated = read("src/app/generated/[...path]/route.ts");
    expect(generated).toContain("db.talkingPhotoJob.findFirst");
    expect(generated).toContain("where: { videoUrl: mediaUrl }");
    expect(generated).toContain("auth.session.userId === talkingPhoto.userId");
    expect(generated).toContain('".m4a": "audio/mp4"');
    expect(generated).toContain('".ogg": "audio/ogg"');
  });

  test("creator UI exposes quote/consent flow but no provider credential or direct provider call", () => {
    const component = read("src/components/TalkingPhotoStudio.tsx");
    expect(component).toContain("/api/photo-studio/talking-photo/quote");
    expect(component).toContain("/api/photo-studio/talking-photo/jobs");
    expect(component).toContain("consentConfirmed: true");
    expect(component).toContain("billingConfirmed: true");
    expect(component).toContain("Review cost");
    expect(component).toContain("Confirm");
    expect(component).not.toContain("FAL_KEY");
    expect(component).not.toContain("queue.fal.run");
  });

  test("production topology supervises the Talking Photo worker and passes FAL_KEY server-side", () => {
    const ecosystem = read("ecosystem.config.js");
    const heartbeat = read("scripts/worker-heartbeat.ts");
    const health = read("scripts/check-pm2-health.ts");
    const rollback = read("rollback.sh");
    expect(ecosystem).toContain("FAL_KEY: process.env.FAL_KEY");
    expect(ecosystem).toContain('name: "vidora-talking-photo-worker"');
    expect(ecosystem).toContain('script: "scripts/talking-photo-worker-entry.ts"');
    expect(heartbeat).toContain('"vidora-talking-photo-worker"');
    expect(health).toContain('"vidora-talking-photo-worker": "scripts/talking-photo-worker-entry.ts"');
    expect(rollback).toContain("vidora-talking-photo-worker");
  });

  test("migration and runtime contract enforce durable job locks and measured duration", () => {
    const migration = read("prisma/migrations/20260918141500_talking_photo_execution/migration.sql");
    const runtime = read("scripts/check-runtime-db-contract.ts");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "TalkingPhotoJob"');
    expect(migration).toContain('"durationSeconds" DOUBLE PRECISION');
    expect(migration).toContain('"TalkingPhotoJob_activeKey_key"');
    expect(migration).toContain("TalkingPhotoJob_duration_positive");
    expect(runtime).toContain("TalkingPhotoJob.activeKey must be unique");
    expect(runtime).toContain("MediaAsset.durationSeconds is missing");
  });
});
