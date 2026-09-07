# Production worker readiness

Vidora's generation and export workers run under PM2 through small supervisor entrypoints.

A worker is considered deployment-ready only when:

1. PM2 reports the expected process as `online`.
2. The supervisor running inside that exact PM2 PID successfully reaches PostgreSQL.
3. The supervisor writes a fresh heartbeat for that PID under `logs/worker-heartbeats/`.
4. `scripts/check-pm2-health.ts` verifies the heartbeat belongs to the current PID and is fresh.

The supervisor keeps probing PostgreSQL after startup. After repeated probe failures it exits intentionally so PM2 restarts the process instead of leaving a disconnected queue consumer displayed as healthy.

Optional environment tuning:

- `WORKER_DB_PROBE_INTERVAL_MS` — defaults to 10000 ms; bounded to 2000–60000 ms.
- `WORKER_DB_FAILURE_LIMIT` — defaults to 3 consecutive failures; bounded to 1–10.
- `PM2_WORKER_HEARTBEAT_MAX_AGE_MS` — deployment-health heartbeat age threshold. By default it is at least 30000 ms and at least three probe intervals.

No credentials or database values are written to heartbeat files; they contain only the worker name, PID, and successful-probe timestamp.
