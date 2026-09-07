# Vidora production monitoring

Vidora includes a self-hosted production health monitor that can run from the existing five-minute cron safety net. It is designed to surface operational failures without requiring a third-party monitoring vendor.

## What is checked

Each monitor run evaluates:

- PostgreSQL connectivity,
- required PM2 processes,
- PID-bound durable generation/export worker database heartbeats,
- stale active generation runs,
- generation runs that require reconciliation,
- stale active export jobs,
- generated-media store writeability and free space,
- backup-store writeability and free space,
- local Vidora HTTP readiness,
- zero-cost public AI configuration readiness.

The monitor does not perform a paid AI provider generation request.

## Health levels

`ok`

All checks pass.

`degraded`

The platform is still serving, but operator attention is needed. Examples include stale durable work, runs needing reconciliation, or disk space below the configured threshold.

`down`

A critical platform dependency is unavailable or unsafe. Examples include PostgreSQL failure, missing/unhealthy PM2 services, invalid durable-worker heartbeats, unwritable storage, local web failure, or AI readiness failure.

## Alert behavior

Set `OPS_ALERT_EMAIL` in the production `.env` to receive email alerts through Vidora's existing TLS SMTP transport.

Alerts are state-change based:

1. A new incident signature sends one alert.
2. Repeated five-minute checks with the same signature do not resend the same email.
3. If the incident changes or escalates, a new alert is sent.
4. When health returns to `ok`, one recovery email is sent, but only if the incident alert was successfully delivered.
5. If SMTP delivery fails, the incident is not marked notified, so the next monitor run retries.

If `OPS_ALERT_EMAIL` is empty, the monitor still logs health state and exits non-zero for degraded/down health, but no email is sent.

## Configuration

Recommended defaults are already documented in `.env.example`:

```bash
OPS_ALERT_EMAIL="operator@example.com"
OPS_LOCAL_BASE_URL="http://127.0.0.1:3004"
OPS_DISK_MIN_FREE_GB="2"
OPS_GENERATION_STALE_MINUTES="15"
OPS_EXPORT_STALE_MINUTES="5"
```

The monitor state defaults to:

```text
/home/lightworld/webapps/vidora/logs/production-monitor-state.json
```

Override it with `OPS_MONITOR_STATE_FILE` only when there is an operational reason to store state elsewhere.

## Install the five-minute cron check

The repository's `cron-check.sh` performs both nginx proxy self-repair and the production health monitor.

Install once for the production user that has permission to run PM2, access the Vidora `.env`, reach PostgreSQL, and write the configured generated/backup directories:

```bash
crontab -e
```

Add:

```cron
*/5 * * * * /home/lightworld/webapps/vidora/cron-check.sh
```

Do not install duplicate entries for different users. PM2 health must be evaluated under the same PM2 user/home context that owns the Vidora processes.

## Manual checks

Run the raw health collector:

```bash
cd /home/lightworld/webapps/vidora
set -a
source .env
set +a
NODE_ENV=production bun scripts/production-health.ts
```

Run the stateful monitor/alert path:

```bash
NODE_ENV=production bun scripts/monitor-production.ts
```

Both commands exit non-zero when health is `degraded` or `down`.

## Logs

Cron output is appended to:

```text
/home/lightworld/webapps/vidora/logs/cron-check.log
```

PM2 application/worker logs remain separate under the existing Vidora log files configured in `ecosystem.config.js`.

## Incident response

For a `down` alert:

1. inspect `pm2 status`,
2. inspect Vidora web/generation/export worker logs,
3. run `bun scripts/production-health.ts` manually,
4. inspect PostgreSQL connectivity,
5. verify generated and backup filesystem capacity/writeability,
6. inspect active `GenerationRun` and `ExportJob` durable state,
7. use the production rollback runbook only when a release-level rollback is actually required.

For a persistent `generation_reconciliation` warning, investigate the affected durable generation run rather than restarting the whole platform blindly.
