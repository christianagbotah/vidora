import { readdir, readFile, rm, statfs } from "fs/promises";
import path from "path";
import { validateDeploymentManifest, type DeploymentManifest } from "./deployment-manifest";

export const DEFAULT_BACKUP_RETENTION_SETS = 5;
export const DEFAULT_BACKUP_HEADROOM_PERCENT = 25;
export const DEFAULT_BACKUP_MIN_FREE_GB = 5;

const GIB = 1024 ** 3;
const AUTOMATIC_DB_BACKUP = /^vidora_db_\d{8}T\d{6}Z_[A-Fa-f0-9]{12}\.sql\.gz$/;
const AUTOMATIC_MEDIA_BACKUP = /^vidora_media_\d{8}T\d{6}Z_[A-Fa-f0-9]{12}\.tar\.gz$/;

export function requiredBackupBytes(opts: {
  mediaBytes: number;
  databaseBytes: number;
  headroomPercent?: number;
  minFreeGb?: number;
}): number {
  const mediaBytes = Math.max(0, Number(opts.mediaBytes) || 0);
  const databaseBytes = Math.max(0, Number(opts.databaseBytes) || 0);
  const headroomPercent = Math.max(0, Math.min(200, Number(opts.headroomPercent ?? DEFAULT_BACKUP_HEADROOM_PERCENT) || 0));
  const minFreeGb = Math.max(0, Number(opts.minFreeGb ?? DEFAULT_BACKUP_MIN_FREE_GB) || 0);
  const estimatedArchiveBytes = mediaBytes + databaseBytes;
  const withHeadroom = Math.ceil(estimatedArchiveBytes * (1 + headroomPercent / 100));
  return Math.max(withHeadroom, Math.ceil(minFreeGb * GIB));
}

export interface RetentionManifestRecord {
  manifestPath: string;
  manifest: DeploymentManifest;
}

export interface RetentionPlan {
  keep: string[];
  prune: Array<{ manifestPath: string; databaseBackup: string; mediaBackup: string }>;
}

function insideDir(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate !== resolvedRoot && resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function automaticBackupArtifact(name: string): boolean {
  return AUTOMATIC_DB_BACKUP.test(name) || AUTOMATIC_MEDIA_BACKUP.test(name);
}

export function planBackupRetention(
  records: RetentionManifestRecord[],
  opts: { backupDir: string; keepHealthy?: number; currentManifest?: string | null },
): RetentionPlan {
  const backupDir = path.resolve(opts.backupDir);
  const keepHealthy = Math.max(1, Math.min(50, Math.trunc(opts.keepHealthy ?? DEFAULT_BACKUP_RETENTION_SETS) || DEFAULT_BACKUP_RETENTION_SETS));
  const currentManifest = opts.currentManifest ? path.resolve(opts.currentManifest) : null;

  const normalized = records.map((record) => ({
    manifestPath: path.resolve(record.manifestPath),
    manifest: validateDeploymentManifest(record.manifest),
  }));

  for (const record of normalized) {
    if (!insideDir(record.manifestPath, backupDir)) throw new Error(`manifest escapes backup directory: ${record.manifestPath}`);
    if (!insideDir(record.manifest.databaseBackup, backupDir)) throw new Error(`database backup escapes backup directory: ${record.manifest.databaseBackup}`);
    if (!insideDir(record.manifest.mediaBackup, backupDir)) throw new Error(`media backup escapes backup directory: ${record.manifest.mediaBackup}`);
  }

  const healthyNewestFirst = normalized
    .filter((record) => record.manifest.status === "healthy")
    .sort((a, b) => Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt));

  const protectedManifests = new Set<string>();
  normalized
    .filter((record) => record.manifest.status !== "healthy")
    .forEach((record) => protectedManifests.add(record.manifestPath));
  healthyNewestFirst.slice(0, keepHealthy).forEach((record) => protectedManifests.add(record.manifestPath));
  if (currentManifest) protectedManifests.add(currentManifest);

  const protectedArtifacts = new Set<string>();
  for (const record of normalized) {
    if (protectedManifests.has(record.manifestPath)) {
      protectedArtifacts.add(path.resolve(record.manifest.databaseBackup));
      protectedArtifacts.add(path.resolve(record.manifest.mediaBackup));
    }
  }

  const prune = healthyNewestFirst
    .filter((record) => !protectedManifests.has(record.manifestPath))
    .map((record) => ({
      manifestPath: record.manifestPath,
      databaseBackup: protectedArtifacts.has(path.resolve(record.manifest.databaseBackup)) ? "" : path.resolve(record.manifest.databaseBackup),
      mediaBackup: protectedArtifacts.has(path.resolve(record.manifest.mediaBackup)) ? "" : path.resolve(record.manifest.mediaBackup),
    }));

  return {
    keep: normalized.filter((record) => protectedManifests.has(record.manifestPath)).map((record) => record.manifestPath),
    prune,
  };
}

export function orphanBackupArtifacts(
  fileNames: string[],
  manifests: DeploymentManifest[],
  backupDir: string,
): string[] {
  const root = path.resolve(backupDir);
  const referenced = new Set<string>();

  for (const raw of manifests) {
    const manifest = validateDeploymentManifest(raw);
    for (const artifact of [manifest.databaseBackup, manifest.mediaBackup]) {
      if (!insideDir(artifact, root)) throw new Error(`backup artifact escapes backup directory: ${artifact}`);
      referenced.add(path.basename(path.resolve(artifact)));
    }
  }

  return fileNames
    .filter((name) => automaticBackupArtifact(name) && !referenced.has(name))
    .map((name) => path.join(root, name));
}

async function loadRetentionRecords(backupDir: string): Promise<RetentionManifestRecord[]> {
  const names = await readdir(backupDir);
  const records: RetentionManifestRecord[] = [];
  for (const name of names) {
    if (!/^vidora_release_.*\.json$/.test(name)) continue;
    const manifestPath = path.join(backupDir, name);
    try {
      const raw = JSON.parse(await readFile(manifestPath, "utf8"));
      records.push({ manifestPath, manifest: validateDeploymentManifest(raw) });
    } catch (error) {
      throw new Error(`invalid recovery manifest ${manifestPath}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return records;
}

async function loadArtifactReferenceManifests(backupDir: string): Promise<DeploymentManifest[]> {
  const names = await readdir(backupDir);
  const manifests: DeploymentManifest[] = [];
  for (const name of names) {
    if (!/^vidora_release_.*\.json$/.test(name) && name !== "vidora_last_successful_release.json") continue;
    const manifestPath = path.join(backupDir, name);
    try {
      const raw = JSON.parse(await readFile(manifestPath, "utf8"));
      manifests.push(validateDeploymentManifest(raw));
    } catch (error) {
      throw new Error(`invalid recovery manifest ${manifestPath}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return manifests;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "capacity") {
    const [backupDir, mediaRaw, databaseRaw, headroomRaw, minFreeRaw] = args;
    if (!backupDir || mediaRaw === undefined || databaseRaw === undefined) {
      throw new Error("usage: backup-policy.ts capacity <backup-dir> <media-bytes> <database-bytes> [headroom-percent] [min-free-gb]");
    }
    const mediaBytes = Number(mediaRaw);
    const databaseBytes = Number(databaseRaw);
    if (!Number.isFinite(mediaBytes) || mediaBytes < 0 || !Number.isFinite(databaseBytes) || databaseBytes < 0) {
      throw new Error("media/database byte estimates must be non-negative numbers");
    }
    const fs = await statfs(backupDir);
    const freeBytes = Number(fs.bavail) * Number(fs.bsize);
    const requiredBytes = requiredBackupBytes({
      mediaBytes,
      databaseBytes,
      headroomPercent: headroomRaw === undefined ? undefined : Number(headroomRaw),
      minFreeGb: minFreeRaw === undefined ? undefined : Number(minFreeRaw),
    });
    process.stdout.write(JSON.stringify({ freeBytes, requiredBytes, ok: freeBytes >= requiredBytes }));
    if (freeBytes < requiredBytes) process.exitCode = 3;
    return;
  }

  if (command === "prune") {
    const [backupDir, keepRaw, currentManifest] = args;
    if (!backupDir) throw new Error("usage: backup-policy.ts prune <backup-dir> [keep-healthy] [current-manifest]");
    const records = await loadRetentionRecords(backupDir);
    const plan = planBackupRetention(records, {
      backupDir,
      keepHealthy: keepRaw === undefined ? undefined : Number(keepRaw),
      currentManifest: currentManifest || null,
    });
    for (const item of plan.prune) {
      if (item.databaseBackup) await rm(item.databaseBackup, { force: true });
      if (item.mediaBackup) await rm(item.mediaBackup, { force: true });
      await rm(item.manifestPath, { force: true });
      console.log(`[backup-retention] pruned ${path.basename(item.manifestPath)}`);
    }

    const artifactManifests = await loadArtifactReferenceManifests(backupDir);
    const fileNames = await readdir(backupDir);
    const orphanArtifacts = orphanBackupArtifacts(fileNames, artifactManifests, backupDir);
    for (const artifact of orphanArtifacts) {
      await rm(artifact, { force: true });
      console.log(`[backup-retention] pruned orphan artifact ${path.basename(artifact)}`);
    }

    console.log(
      `[backup-retention] kept ${plan.keep.length} protected manifest(s); ` +
      `pruned ${plan.prune.length} old healthy set(s); ` +
      `pruned ${orphanArtifacts.length} unreferenced automatic artifact(s)`,
    );
    return;
  }

  throw new Error("usage: backup-policy.ts <capacity|prune> ...");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "backup policy failed");
    process.exitCode = 1;
  });
}
