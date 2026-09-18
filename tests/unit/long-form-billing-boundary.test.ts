import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8");
}

describe("long-form provider billing boundary", () => {
  test("story-bible planning reserves before strict billed text submission and settles actual usage", () => {
    const route = read("src/app/api/creative/long-form/plan/route.ts");
    const reserveIndex = route.indexOf("reserveMeteredTextOperation(");
    const submitIndex = route.indexOf("submitBilledText(");
    const captureIndex = route.indexOf("captureActualMeteredLine(");
    const finalizeIndex = route.indexOf("finalizeMeteredReservation(");

    expect(reserveIndex).toBeGreaterThan(-1);
    expect(submitIndex).toBeGreaterThan(reserveIndex);
    expect(captureIndex).toBeGreaterThan(submitIndex);
    expect(finalizeIndex).toBeGreaterThan(captureIndex);
    expect(route).not.toContain("zai.chat(");
    expect(route).not.toContain("generateProviderText(");
    expect(route).not.toContain("withRetry(");
    expect(route).toContain("provider: billing.provider");
  });

  test("story-bible idempotency replay is rejected before another paid planning call", () => {
    const route = read("src/app/api/creative/long-form/plan/route.ts");
    const replayLookup = route.indexOf("findReservationByReference(referenceId)");
    const reserveIndex = route.indexOf("reserveMeteredTextOperation(");
    expect(replayLookup).toBeGreaterThan(-1);
    expect(replayLookup).toBeLessThan(reserveIndex);
    expect(route).toContain("replayed: true");
    expect(route).toContain("status: 409");
  });

  test("malformed paid story-bible output is not automatically resubmitted", () => {
    const route = read("src/app/api/creative/long-form/plan/route.ts");
    expect(route).toContain('code: "LONG_FORM_PLAN_INVALID"');
    expect(route).toContain("No provider call will be repeated automatically");
    expect((route.match(/submitBilledText\(/g) || []).length).toBe(1);
  });

  test("valid paid story-bible output is persisted transactionally and a DB failure returns the plan instead of paying twice", () => {
    const route = read("src/app/api/creative/long-form/plan/route.ts");
    const store = read("src/lib/long-form-store.ts");
    expect(route).toContain("persistLongFormPlan({");
    expect(route).toContain('code: "LONG_FORM_PERSISTENCE_FAILED"');
    expect(route).toContain("The validated plan is returned below so it is not lost");
    expect(route).toContain("plan,");
    expect(store).toContain("db.$transaction(async (tx) =>");
    expect(store).toContain('ON CONFLICT ("planningReferenceId") DO NOTHING');
    expect(store).toContain("alreadyPersisted: true");
  });

  test("episode expansion validates version, replay and lease before any paid reservation", () => {
    const route = read("src/app/api/creative/long-form/episodes/[id]/expand/route.ts");
    const versionCheck = route.indexOf("expectedExpansionVersion !== context.episode.expansionVersion");
    const replayLookup = route.indexOf("findReservationByReference(referenceId)");
    const leaseIndex = route.indexOf("claimLongFormEpisodeExpansion({");
    const reserveIndex = route.indexOf("reserveMeteredTextOperation(");
    const submitIndex = route.indexOf("submitBilledText(");
    const captureIndex = route.indexOf("captureActualMeteredLine(");

    expect(versionCheck).toBeGreaterThan(-1);
    expect(versionCheck).toBeLessThan(replayLookup);
    expect(replayLookup).toBeLessThan(leaseIndex);
    expect(leaseIndex).toBeLessThan(reserveIndex);
    expect(submitIndex).toBeGreaterThan(reserveIndex);
    expect(captureIndex).toBeGreaterThan(submitIndex);
    expect((route.match(/submitBilledText\(/g) || []).length).toBe(1);
    expect(route).not.toContain("zai.chat(");
    expect(route).not.toContain("withRetry(");
  });

  test("episode lease blocks different concurrent keys and is owned by the exact expansion reference", () => {
    const store = read("src/lib/long-form-sequence-store.ts");
    expect(store).toContain("LongFormExpansionBusyError");
    expect(store).toContain('readonly code = "LONG_FORM_EXPANSION_IN_PROGRESS"');
    expect(store).toContain("episode.expansionActiveKey === opts.activeKey");
    expect(store).toContain('SET "expansionActiveKey" = ${opts.activeKey}');
    expect(store).toContain('"expansionClaimedAt" = CURRENT_TIMESTAMP');
    expect(store).toContain("episode.expansionActiveKey !== opts.activeKey");
  });

  test("known pre-provider failure releases the lease while indeterminate provider submission keeps it held", () => {
    const route = read("src/app/api/creative/long-form/episodes/[id]/expand/route.ts");
    expect(route).toContain("let providerSubmissionStarted = false");
    expect(route).toContain("providerSubmissionStarted = true");
    expect(route).toContain("if (!providerSubmissionStarted) await releaseClaim()");
    expect(route).toContain("prepaid episode-expansion reserve and lease are held for reconciliation");
    expect(route).toContain("expansionLeaseHeld: true");
  });

  test("malformed or conflicting paid sequence output is returned without hidden provider retry", () => {
    const route = read("src/app/api/creative/long-form/episodes/[id]/expand/route.ts");
    expect(route).toContain('code: "LONG_FORM_SEQUENCE_PLAN_INVALID"');
    expect(route).toContain("will not be repeated automatically");
    expect(route).toContain("await releaseClaim()");
    expect(route).toContain("LongFormExpansionConflictError");
    expect(route).toContain("LongFormExpansionBusyError");
    expect(route).toContain("sequences,");
    expect(route).toContain('code: "LONG_FORM_SEQUENCE_PERSISTENCE_FAILED"');
  });

  test("sequence replacement uses ownership, row locking, optimistic versioning and consumes its lease", () => {
    const store = read("src/lib/long-form-sequence-store.ts");
    expect(store).toContain('p."userId" = ${opts.userId}');
    expect(store).toContain("FOR UPDATE OF e");
    expect(store).toContain("episode.expansionVersion !== opts.expectedExpansionVersion");
    expect(store).toContain('DELETE FROM "LongFormSequence"');
    expect(store).toContain('SET "status" = \'sequenced\'');
    expect(store).toContain('"expansionVersion" = ${expansionVersion}');
    expect(store).toContain('"expansionActiveKey" = NULL');
    expect(store).toContain('"expansionClaimedAt" = NULL');
  });

  test("migration declares durable hierarchy plus the unique episode expansion lease", () => {
    const migration = read("prisma/migrations/20260911095500_long_form_production_hierarchy/migration.sql");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "LongFormProduction"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "LongFormSeason"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "LongFormEpisode"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "LongFormSequence"');
    expect(migration).toContain('"LongFormProduction_planningReferenceId_key"');
    expect(migration).toContain('"LongFormSeason_productionId_seasonNumber_key"');
    expect(migration).toContain('"LongFormEpisode_seasonId_episodeNumber_key"');
    expect(migration).toContain('"LongFormEpisode_expansionActiveKey_key"');
    expect(migration).toContain('"LongFormSequence_episodeId_sequenceNumber_key"');
  });
});
