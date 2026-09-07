# Vidora production rollback

Vidora deployments create a recovery point before any production migration runs. The recovery point consists of:

- a gzip-compressed PostgreSQL dump,
- a generated-media archive,
- SHA-256 checksums for both archives,
- the release SHA being deployed,
- the commit that was on disk immediately before that deploy,
- the generated-media directory,
- a timestamped recovery manifest.

A manifest is written with `status: prepared` before `prisma migrate deploy`. It is marked `healthy` only after PM2 worker readiness, local web reachability, and `/api/ai/health` all pass. The latest healthy manifest is also copied to:

`$BACKUP_DIR/vidora_last_successful_release.json`

## Rollback is intentionally explicit

A failed deployment does **not** automatically restore its pre-deploy backup. Automatic rollback could erase valid writes made after a release started serving traffic. An operator must select the intended manifest and explicitly acknowledge the destructive restore.

Run from the Vidora production repository:

```bash
./rollback.sh \
  --manifest /absolute/path/from/BACKUP_DIR/vidora_release_<timestamp>_<sha>.json \
  --confirm-destructive-restore
```

The rollback command refuses to continue unless:

- the production working tree is clean,
- the manifest lives under the configured `BACKUP_DIR`,
- the manifest release SHA matches the currently checked-out release,
- the prior commit exists locally,
- both backup files live under `BACKUP_DIR`,
- both SHA-256 checksums match,
- both archives pass integrity checks,
- the manifest generated-media directory exactly matches `GENERATED_DIR`,
- the database uses Vidora's canonical PostgreSQL `public` schema.

## Recovery sequence

Before destructive restore, rollback creates an emergency snapshot of the current/failed state:

- `vidora_emergency_db_<timestamp>_<release>.sql.gz`
- `vidora_emergency_media_<timestamp>_<release>.tar.gz`

It then:

1. stops the web app, generation worker, and export worker;
2. restores the manifest PostgreSQL dump into a fresh `public` schema;
3. replaces generated media from the manifest archive;
4. checks out the previous release commit as detached HEAD;
5. installs the frozen dependency set;
6. validates/generates Prisma and runs `prisma migrate deploy` against the restored database;
7. builds the previous release;
8. starts/reloads PM2;
9. verifies PM2/worker readiness;
10. verifies local HTTP 200 and `/api/ai/health` status `ok`;
11. writes a timestamped rollback record under `BACKUP_DIR`.

If rollback fails **before** destructive restore starts, the script attempts to restart the current release. If it fails **after** destructive restore begins, all Vidora processes are stopped again and the emergency/current-state snapshots plus intended recovery archives are printed for manual recovery.

## After a successful rollback

The repository remains on detached HEAD at the restored prior release. This is deliberate: it avoids rewriting the `main` branch. A later normal `deploy.sh` run checks out and fast-forwards `main` again.

Do not delete the selected recovery manifest, its referenced database/media archives, or the emergency snapshots until the incident has been reviewed and the recovered release has been verified externally.
