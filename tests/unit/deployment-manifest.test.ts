import { describe, expect, test } from "bun:test";
import { validateDeploymentManifest } from "../../scripts/deployment-manifest";

const valid = {
  version: 1 as const,
  previousSha: "a".repeat(40),
  releaseSha: "b".repeat(40),
  databaseBackup: "/var/backups/vidora/vidora_db.sql.gz",
  databaseBackupSha256: "c".repeat(64),
  mediaBackup: "/var/backups/vidora/vidora_media.tar.gz",
  mediaBackupSha256: "d".repeat(64),
  generatedDir: "/srv/vidora-generated",
  createdAt: "2026-09-07T10:00:00.000Z",
  status: "prepared" as const,
};

describe("Vidora deployment recovery manifest", () => {
  test("accepts and normalizes a valid manifest", () => {
    expect(validateDeploymentManifest({
      ...valid,
      previousSha: valid.previousSha.toUpperCase(),
      databaseBackupSha256: valid.databaseBackupSha256.toUpperCase(),
    })).toEqual({
      ...valid,
      previousSha: valid.previousSha,
      databaseBackupSha256: valid.databaseBackupSha256,
    });
  });

  test("accepts the healthy terminal state", () => {
    expect(validateDeploymentManifest({ ...valid, status: "healthy" }).status).toBe("healthy");
  });

  test("rejects malformed commit SHAs and checksums", () => {
    expect(() => validateDeploymentManifest({ ...valid, previousSha: "abc" })).toThrow("previousSha");
    expect(() => validateDeploymentManifest({ ...valid, releaseSha: "z".repeat(40) })).toThrow("releaseSha");
    expect(() => validateDeploymentManifest({ ...valid, mediaBackupSha256: "d".repeat(63) })).toThrow("mediaBackupSha256");
  });

  test("rejects relative recovery paths", () => {
    expect(() => validateDeploymentManifest({ ...valid, databaseBackup: "backup.sql.gz" })).toThrow("absolute path");
    expect(() => validateDeploymentManifest({ ...valid, generatedDir: "generated" })).toThrow("absolute path");
  });

  test("rejects unsupported versions, statuses, and timestamps", () => {
    expect(() => validateDeploymentManifest({ ...valid, version: 2 })).toThrow("version");
    expect(() => validateDeploymentManifest({ ...valid, status: "failed" })).toThrow("status");
    expect(() => validateDeploymentManifest({ ...valid, createdAt: "not-a-date" })).toThrow("createdAt");
  });
});
