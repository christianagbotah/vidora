import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8");
}

describe("long-form provider billing boundary", () => {
  test("reserves before the strict billed text submission and settles actual usage", () => {
    const route = read("src/app/api/creative/long-form/plan/route.ts");
    const reserveIndex = route.indexOf("reserveMeteredZaiTextOperation(");
    const submitIndex = route.indexOf("submitBilledZaiText(");
    const captureIndex = route.indexOf("captureActualMeteredLine(");
    const finalizeIndex = route.indexOf("finalizeMeteredReservation(");

    expect(reserveIndex).toBeGreaterThan(-1);
    expect(submitIndex).toBeGreaterThan(reserveIndex);
    expect(captureIndex).toBeGreaterThan(submitIndex);
    expect(finalizeIndex).toBeGreaterThan(captureIndex);
    expect(route).not.toContain("zai.chat(");
    expect(route).not.toContain("generateProviderText(");
    expect(route).not.toContain("withRetry(");
  });

  test("explicit idempotency replay is rejected before another paid planning call", () => {
    const route = read("src/app/api/creative/long-form/plan/route.ts");
    const replayLookup = route.indexOf("findReservationByReference(referenceId)");
    const reserveIndex = route.indexOf("reserveMeteredZaiTextOperation(");
    expect(replayLookup).toBeGreaterThan(-1);
    expect(replayLookup).toBeLessThan(reserveIndex);
    expect(route).toContain("replayed: true");
    expect(route).toContain("status: 409");
  });

  test("malformed paid output is not automatically resubmitted", () => {
    const route = read("src/app/api/creative/long-form/plan/route.ts");
    expect(route).toContain('code: "LONG_FORM_PLAN_INVALID"');
    expect(route).toContain("No provider call will be repeated automatically");
    expect((route.match(/submitBilledZaiText\(/g) || []).length).toBe(1);
  });

  test("valid paid output is persisted transactionally and a DB failure returns the plan instead of paying twice", () => {
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

  test("migration declares durable production, season, episode and sequence hierarchy", () => {
    const migration = read("prisma/migrations/20260911095500_long_form_production_hierarchy/migration.sql");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "LongFormProduction"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "LongFormSeason"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "LongFormEpisode"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "LongFormSequence"');
    expect(migration).toContain('"LongFormProduction_planningReferenceId_key"');
    expect(migration).toContain('"LongFormSeason_productionId_seasonNumber_key"');
    expect(migration).toContain('"LongFormEpisode_seasonId_episodeNumber_key"');
    expect(migration).toContain('"LongFormSequence_episodeId_sequenceNumber_key"');
  });
});
