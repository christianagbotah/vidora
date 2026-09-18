import { describe, expect, test } from "bun:test";
import { workerHeartbeatPath } from "../../scripts/worker-heartbeat";

describe("Vidora durable worker heartbeat paths", () => {
  test("keeps heartbeat files inside the release logs directory", () => {
    expect(workerHeartbeatPath("vidora-generation-worker", "/srv/vidora"))
      .toBe("/srv/vidora/logs/worker-heartbeats/vidora-generation-worker.json");
    expect(workerHeartbeatPath("vidora-export-worker", "/srv/vidora"))
      .toBe("/srv/vidora/logs/worker-heartbeats/vidora-export-worker.json");
    expect(workerHeartbeatPath("vidora-talking-photo-worker", "/srv/vidora"))
      .toBe("/srv/vidora/logs/worker-heartbeats/vidora-talking-photo-worker.json");
  });
});
