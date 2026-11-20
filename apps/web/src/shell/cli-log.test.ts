import { range } from "es-toolkit";
import { describe, expect, it } from "vitest";

import type { CliEntry } from "./cli-log";
import { exitLine, mergeById, mergeCliLog } from "./cli-log";

const entry = (id: number, overrides: Partial<CliEntry> = {}): CliEntry => ({
  id,
  seq: id,
  startedAt: 0,
  line: `oled run ${String(id)}`,
  exitCode: 0,
  durationMs: null,
  ...overrides,
});

const ids = (entries: readonly CliEntry[]) => entries.map((item) => item.id);

describe("mergeById", () => {
  it("lets a later read of an id replace it in its original slot", () => {
    const merged = mergeById(
      [entry(1), entry(2, { exitCode: null })],
      [entry(2, { exitCode: 3 }), entry(3)],
      10,
    );
    expect(ids(merged)).toEqual([1, 2, 3]);
    expect(merged[1]?.exitCode).toBe(3);
  });

  it("keeps only the newest entries the window holds", () => {
    const merged = mergeById([entry(1), entry(2)], [entry(3), entry(4)], 3);
    expect(ids(merged)).toEqual([2, 3, 4]);
  });

  it("does not mutate either input", () => {
    const current = [entry(1)];
    const delta = [entry(1, { exitCode: 1 })];
    mergeById(current, delta, 10);
    expect(current[0]?.exitCode).toBe(0);
    expect(delta).toHaveLength(1);
  });
});

describe("mergeCliLog", () => {
  it("never holds more than the server ring's 200 invocations", () => {
    const current = range(150).map((id) => entry(id));
    const delta = range(150, 250).map((id) => entry(id));
    const merged = mergeCliLog(current, delta);
    expect(merged).toHaveLength(200);
    expect(merged[0]?.id).toBe(50);
    expect(merged.at(-1)?.id).toBe(249);
  });
});

describe("exitLine", () => {
  it("leaves the duration off while it is unknown", () => {
    expect(exitLine(entry(1, { exitCode: 0, durationMs: null }))).toBe(
      "exit 0",
    );
  });

  it("states the duration in seconds to one decimal", () => {
    expect(exitLine(entry(1, { exitCode: 2, durationMs: 1234 }))).toBe(
      "exit 2 · 1.2s",
    );
  });
});
