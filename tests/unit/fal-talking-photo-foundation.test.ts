import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("fal Talking Photo provider foundation", () => {
  test("uses the durable fal queue from the server and never exposes the key to client code", () => {
    const client = read("src/lib/fal-lipsync.ts");
    expect(client).toContain('getConfigValue("fal_api_key", "FAL_KEY")');
    expect(client).toContain('"https://queue.fal.run"');
    expect(client).toContain('Authorization: `Key ${falKey}`');
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
    expect(client).toContain("async function requireFalKey");
    expect(client).toContain("await requireFalKey()");
  });

  test("admin-managed fal secret stays server-side and encrypted", () => {
    const secure = read("src/lib/secure-config.ts");
    const policy = read("src/lib/provider-secret-policy.ts");
    const config = read("src/app/api/admin/config/route.ts");
    const page = read("src/app/admin/providers/page.tsx");
    expect(secure).toContain('"fal_api_key"');
    expect(policy).toContain('"fal_api_key"');
    expect(config).toContain('fal_api_key: "FAL_KEY"');
    expect(config).toContain('talkingPhoto: ["fal"]');
    expect(page).toContain('setSecretField("fal_api_key"');
    expect(page).toContain("Environment fallback: FAL_KEY");
    expect(page).not.toContain("NEXT_PUBLIC_FAL");
  });

  test("verified price is versioned, runtime-required and admin-reverifiable", () => {
    const migration = read("prisma/migrations/20260918135000_fal_sync3_lipsync_pricing/migration.sql");
    const runtime = read("scripts/check-runtime-db-contract.ts");
    const admin = read("src/app/api/admin/billing/route.ts");
    expect(migration).toContain("'fal'");
    expect(migration).toContain("'fal-ai/sync-lipsync/v3/image-to-video'");
    expect(migration).toContain("'lip_sync'");
    expect(migration).toContain("'second'");
    expect(migration).toContain("0.1333");
    expect(migration).toContain("fal-sync3-image-to-video-2026-09-18");
    expect(runtime).toContain("fal:fal-ai/sync-lipsync/v3/image-to-video:lip_sync");
    expect(admin).toContain('"zai", "qwen", "fal"');
    expect(admin).toContain('"lip_sync"');
    expect(admin).toContain('"second"');
  });

  test("no user-facing execution route exists until durable consent/audio/billing orchestration is added", () => {
    const billing = read("src/lib/fal-lipsync-billing.ts");
    expect(billing).toContain('provider: "fal"');
    expect(billing).toContain("quoteProviderCharge");
    expect(billing).not.toContain("reserveImmediateProviderOperation");
    expect(billing).not.toContain("captureImmediateProviderOperation");
  });
});
