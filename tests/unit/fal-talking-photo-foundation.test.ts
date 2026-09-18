import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("fal Talking Photo provider foundation", () => {
  test("uses the durable fal queue from the server and never exposes the key to client code", () => {
    const client = read("src/lib/fal-lipsync.ts");
    expect(client).toContain('process.env.FAL_KEY');
    expect(client).toContain('"https://queue.fal.run"');
    expect(client).toContain('Authorization: `Key ${requireFalKey()}`');
    expect(client).toContain("/requests/");
    expect(client).toContain("/status");
    expect(client).toContain('image_url: imageUrl');
    expect(client).toContain('audio_url: audioUrl');
    expect(client).not.toContain("NEXT_PUBLIC_FAL");
  });

  test("fails closed on unsafe media URLs and missing provider configuration", () => {
    const client = read("src/lib/fal-lipsync.ts");
    expect(client).toContain('parsed.protocol !== "https:"');
    expect(client).toContain("FAL_INPUT_URL_UNSAFE");
    expect(client).toContain("FAL_KEY_MISSING");
    expect(client).toContain("FAL_PROVIDER_RESPONSE_INVALID");
    expect(client).toContain("FAL_PROVIDER_RESULT_INVALID");
  });

  test("verified price is versioned in migrations and required by runtime contract", () => {
    const migration = read("prisma/migrations/20260918135000_fal_sync3_lipsync_pricing/migration.sql");
    const runtime = read("scripts/check-runtime-db-contract.ts");
    expect(migration).toContain("'fal'");
    expect(migration).toContain("'fal-ai/sync-lipsync/v3/image-to-video'");
    expect(migration).toContain("'lip_sync'");
    expect(migration).toContain("'second'");
    expect(migration).toContain("0.1333");
    expect(migration).toContain("fal-sync3-image-to-video-2026-09-18");
    expect(runtime).toContain("fal:fal-ai/sync-lipsync/v3/image-to-video:lip_sync");
  });

  test("no user-facing execution route exists until durable consent/audio/billing orchestration is added", () => {
    const billing = read("src/lib/fal-lipsync-billing.ts");
    expect(billing).toContain('provider: "fal"');
    expect(billing).toContain("quoteProviderCharge");
    expect(billing).not.toContain("reserveImmediateProviderOperation");
    expect(billing).not.toContain("captureImmediateProviderOperation");
  });
});
