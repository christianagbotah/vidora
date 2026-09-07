import { readFile, rename, writeFile } from "fs/promises";

export type DeploymentManifestStatus = "prepared" | "healthy";

export interface DeploymentManifest {
  version: 1;
  previousSha: string;
  releaseSha: string;
  databaseBackup: string;
  databaseBackupSha256: string;
  mediaBackup: string;
  mediaBackupSha256: string;
  generatedDir: string;
  createdAt: string;
  status: DeploymentManifestStatus;
}

const SHA_RE = /^[a-f0-9]{40}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/i;

function requireAbsolutePath(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) {
    throw new Error(`${field} must be an absolute path`);
  }
  return value;
}

export function validateDeploymentManifest(raw: unknown): DeploymentManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("deployment manifest must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) throw new Error("unsupported deployment manifest version");
  if (typeof value.previousSha !== "string" || !SHA_RE.test(value.previousSha)) {
    throw new Error("previousSha must be a full Git commit SHA");
  }
  if (typeof value.releaseSha !== "string" || !SHA_RE.test(value.releaseSha)) {
    throw new Error("releaseSha must be a full Git commit SHA");
  }
  if (typeof value.databaseBackupSha256 !== "string" || !SHA256_RE.test(value.databaseBackupSha256)) {
    throw new Error("databaseBackupSha256 must be SHA-256 hex");
  }
  if (typeof value.mediaBackupSha256 !== "string" || !SHA256_RE.test(value.mediaBackupSha256)) {
    throw new Error("mediaBackupSha256 must be SHA-256 hex");
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    throw new Error("createdAt must be an ISO-compatible timestamp");
  }
  if (value.status !== "prepared" && value.status !== "healthy") {
    throw new Error("status must be prepared or healthy");
  }

  return {
    version: 1,
    previousSha: value.previousSha.toLowerCase(),
    releaseSha: value.releaseSha.toLowerCase(),
    databaseBackup: requireAbsolutePath(value.databaseBackup, "databaseBackup"),
    databaseBackupSha256: value.databaseBackupSha256.toLowerCase(),
    mediaBackup: requireAbsolutePath(value.mediaBackup, "mediaBackup"),
    mediaBackupSha256: value.mediaBackupSha256.toLowerCase(),
    generatedDir: requireAbsolutePath(value.generatedDir, "generatedDir"),
    createdAt: value.createdAt,
    status: value.status,
  };
}

export async function readDeploymentManifest(filePath: string): Promise<DeploymentManifest> {
  return validateDeploymentManifest(JSON.parse(await readFile(filePath, "utf8")));
}

export async function writeDeploymentManifest(
  filePath: string,
  manifest: DeploymentManifest,
): Promise<void> {
  const valid = validateDeploymentManifest(manifest);
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

async function main(): Promise<void> {
  const [command, filePath, ...args] = process.argv.slice(2);
  if (!command || !filePath) {
    throw new Error("usage: deployment-manifest.ts <write|mark|fields> <manifest> [...]");
  }

  if (command === "write") {
    const [previousSha, releaseSha, databaseBackup, databaseBackupSha256, mediaBackup, mediaBackupSha256, generatedDir] = args;
    if (!generatedDir) throw new Error("write requires previous/release SHAs, backup paths/checksums, and generated dir");
    await writeDeploymentManifest(filePath, {
      version: 1,
      previousSha,
      releaseSha,
      databaseBackup,
      databaseBackupSha256,
      mediaBackup,
      mediaBackupSha256,
      generatedDir,
      createdAt: new Date().toISOString(),
      status: "prepared",
    });
    return;
  }

  if (command === "mark") {
    const status = args[0];
    if (status !== "prepared" && status !== "healthy") throw new Error("invalid manifest status");
    const manifest = await readDeploymentManifest(filePath);
    await writeDeploymentManifest(filePath, { ...manifest, status });
    return;
  }

  if (command === "fields") {
    const manifest = await readDeploymentManifest(filePath);
    const values = [
      manifest.previousSha,
      manifest.releaseSha,
      manifest.databaseBackup,
      manifest.databaseBackupSha256,
      manifest.mediaBackup,
      manifest.mediaBackupSha256,
      manifest.generatedDir,
      manifest.status,
    ];
    process.stdout.write(values.join("\0") + "\0");
    return;
  }

  throw new Error(`unsupported manifest command: ${command}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "deployment manifest command failed");
    process.exitCode = 1;
  });
}
