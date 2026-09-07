import { describe, expect, test } from "bun:test";
import {
  planBackupRetention,
  requiredBackupBytes,
  type RetentionManifestRecord,
} from "../../scripts/backup-policy";
import type { DeploymentManifest } from "../../scripts/deployment-manifest";

const BACKUP_DIR = "/backups/vidora";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST = "c".repeat(64);

function record(name: string, createdAt: string, status: "prepared" | "healthy", shared?: { db?: string; media?: string }): RetentionManifestRecord {
  const manifestPath = `${BACKUP_DIR}/${name}.json`;
  const manifest: DeploymentManifest = {
    version: 1,
    previousSha: SHA_A,
    releaseSha: SHA_B,
    databaseBackup: shared?.db ?? `${BACKUP_DIR}/${name}.sql.gz`,
    databaseBackupSha256: DIGEST,
    mediaBackup: shared?.media ?? `${BACKUP_DIR}/${name}.tar.gz`,
    mediaBackupSha256: DIGEST,
    generatedDir: "/srv/vidora/generated",
    createdAt,
    status,
  };
  return { manifestPath, manifest };
}

describe("Vidora backup capacity policy", () => {
  test("uses the larger of estimated archive headroom and minimum free-space floor", () => {
    expect(requiredBackupBytes({ mediaBytes: 2_000, databaseBytes: 1_000, headroomPercent: 25, minFreeGb: 0 })).toBe(3_750);
    expect(requiredBackupBytes({ mediaBytes: 1, databaseBytes: 1, headroomPercent: 0, minFreeGb: 1 })).toBe(1024 ** 3);
  });

  test("clamps negative estimates and excessive headroom safely", () => {
    expect(requiredBackupBytes({ mediaBytes: -1, databaseBytes: -2, headroomPercent: 999, minFreeGb: 0 })).toBe(0);
  });
});

describe("Vidora backup retention policy", () => {
  test("keeps the newest healthy sets and prunes older healthy sets", () => {
    const records = [
      record("vidora_release_1", "2026-09-01T00:00:00Z", "healthy"),
      record("vidora_release_2", "2026-09-02T00:00:00Z", "healthy"),
      record("vidora_release_3", "2026-09-03T00:00:00Z", "healthy"),
    ];
    const plan = planBackupRetention(records, { backupDir: BACKUP_DIR, keepHealthy: 2 });
    expect(plan.keep.sort()).toEqual([records[1].manifestPath, records[2].manifestPath].sort());
    expect(plan.prune).toEqual([{
      manifestPath: records[0].manifestPath,
      databaseBackup: records[0].manifest.databaseBackup,
      mediaBackup: records[0].manifest.mediaBackup,
    }]);
  });

  test("never auto-prunes prepared recovery manifests", () => {
    const prepared = record("vidora_release_prepared", "2026-08-01T00:00:00Z", "prepared");
    const healthy = record("vidora_release_healthy", "2026-09-03T00:00:00Z", "healthy");
    const plan = planBackupRetention([prepared, healthy], { backupDir: BACKUP_DIR, keepHealthy: 1 });
    expect(plan.keep).toContain(prepared.manifestPath);
    expect(plan.prune).toEqual([]);
  });

  test("protects the explicitly current manifest even when it is older than retention", () => {
    const oldCurrent = record("vidora_release_old_current", "2026-08-01T00:00:00Z", "healthy");
    const newer = record("vidora_release_new", "2026-09-03T00:00:00Z", "healthy");
    const plan = planBackupRetention([oldCurrent, newer], {
      backupDir: BACKUP_DIR,
      keepHealthy: 1,
      currentManifest: oldCurrent.manifestPath,
    });
    expect(plan.keep).toContain(oldCurrent.manifestPath);
    expect(plan.prune).toEqual([]);
  });

  test("does not delete an artifact still referenced by a protected manifest", () => {
    const sharedDb = `${BACKUP_DIR}/shared.sql.gz`;
    const protectedPrepared = record("vidora_release_prepared", "2026-09-01T00:00:00Z", "prepared", { db: sharedDb });
    const oldHealthy = record("vidora_release_old", "2026-08-01T00:00:00Z", "healthy", { db: sharedDb });
    const newestHealthy = record("vidora_release_new", "2026-09-03T00:00:00Z", "healthy");
    const plan = planBackupRetention([protectedPrepared, oldHealthy, newestHealthy], {
      backupDir: BACKUP_DIR,
      keepHealthy: 1,
    });
    expect(plan.prune).toEqual([{
      manifestPath: oldHealthy.manifestPath,
      databaseBackup: "",
      mediaBackup: oldHealthy.manifest.mediaBackup,
    }]);
  });

  test("fails closed when any manifest or artifact escapes the backup directory", () => {
    const unsafe = record("vidora_release_unsafe", "2026-09-03T00:00:00Z", "healthy", { db: "/tmp/escape.sql.gz" });
    expect(() => planBackupRetention([unsafe], { backupDir: BACKUP_DIR, keepHealthy: 1 })).toThrow("database backup escapes backup directory");
  });
});
