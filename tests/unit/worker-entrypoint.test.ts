import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("durable worker executable compatibility", () => {
  test("historical generation worker path is now the supervised executable", () => {
    const wrapper = read("scripts/generation-worker.ts");
    const runner = read("scripts/generation-worker-runner.ts");
    const entry = read("scripts/generation-worker-entry.ts");

    expect(wrapper).toContain('superviseWorker(');
    expect(wrapper).toContain('"vidora-generation-worker"');
    expect(wrapper).toContain('import("./generation-worker-runner")');
    expect(runner).toContain('[generation-worker] started');
    expect(entry.trim()).toBe('import "./generation-worker";');
  });

  test("historical export worker path is now the supervised executable", () => {
    const wrapper = read("scripts/export-worker.ts");
    const runner = read("scripts/export-worker-runner.ts");
    const entry = read("scripts/export-worker-entry.ts");

    expect(wrapper).toContain('superviseWorker(');
    expect(wrapper).toContain('"vidora-export-worker"');
    expect(wrapper).toContain('import("./export-worker-runner")');
    expect(runner).toContain('[export-worker] started');
    expect(entry.trim()).toBe('import "./export-worker";');
  });
});
