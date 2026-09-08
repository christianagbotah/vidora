import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";

const SCRIPT = path.join(process.cwd(), "scripts/check-storage-path-topology.sh");

function check(projectDir: string, generatedDir: string, backupDir: string) {
  const result = spawnSync("bash", [SCRIPT, projectDir, generatedDir, backupDir], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("production storage path topology", () => {
  test("accepts Vidora's documented production layout", () => {
    const result = check(
      "/home/lightworld/webapps/vidora",
      "/home/lightworld/webapps/vidora/generated-store",
      "/home/lightworld/backups/vidora",
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Storage path topology: OK");
  });

  test("does not confuse safe prefix-lookalike siblings with descendants", () => {
    const result = check(
      "/srv/vidora",
      "/srv/vidora/generated-store",
      "/srv/vidora-backups",
    );
    expect(result.status).toBe(0);
  });

  test("rejects backup storage inside generated media", () => {
    const result = check(
      "/srv/vidora",
      "/srv/media/vidora",
      "/srv/media/vidora/recovery",
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must not overlap");
  });

  test("rejects generated media inside backup storage", () => {
    const result = check(
      "/srv/vidora",
      "/srv/recovery/vidora/generated-store",
      "/srv/recovery/vidora",
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must not overlap");
  });

  test("rejects identical generated and backup directories", () => {
    const result = check("/srv/vidora", "/srv/media", "/srv/media");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must not overlap");
  });

  test("rejects recovery storage anywhere inside the Git checkout", () => {
    const result = check(
      "/srv/vidora",
      "/srv/vidora/generated-store",
      "/srv/vidora/recovery",
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("outside the Vidora project checkout");
  });

  test("rejects project-root and disposable-build generated media targets", () => {
    expect(check("/srv/vidora", "/srv/vidora", "/srv/backups").status).not.toBe(0);
    expect(check("/srv/vidora", "/srv/vidora/.next/generated", "/srv/backups").status).not.toBe(0);
  });

  test("rejects relative storage paths", () => {
    expect(check("/srv/vidora", "generated-store", "/srv/backups").status).not.toBe(0);
    expect(check("/srv/vidora", "/srv/media", "backups").status).not.toBe(0);
  });
});

describe("deploy and rollback storage guard wiring", () => {
  test("both production scripts fail closed through the shared topology guard", () => {
    const deploy = read("deploy.sh");
    const rollback = read("rollback.sh");
    const invocation = 'bash scripts/check-storage-path-topology.sh "$PROJECT_DIR" "$GENERATED_DIR" "$BACKUP_DIR"';

    expect(deploy).toContain(invocation);
    expect(rollback).toContain(invocation);

    expect(deploy.indexOf(invocation)).toBeLessThan(deploy.indexOf("git fetch --prune origin"));
    expect(deploy.indexOf(invocation)).toBeLessThan(deploy.indexOf('mkdir -p "$BACKUP_DIR" "$GENERATED_DIR"'));
    expect(rollback.indexOf(invocation)).toBeLessThan(rollback.indexOf("stop_vidora_services"));
  });
});
