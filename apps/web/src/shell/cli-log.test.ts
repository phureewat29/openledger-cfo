import { describe, expect, it } from "vitest";

import type { CliEntry } from "./cli-log";
import { commandText, exitLine, newestUseful } from "./cli-log";

const entry = (id: number, overrides: Partial<CliEntry> = {}): CliEntry => ({
  id,
  seq: id,
  startedAt: 0,
  line: `oled run ${String(id)}`,
  exitCode: 0,
  durationMs: null,
  ...overrides,
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

describe("newestUseful", () => {
  it("passes over newer poll reads to the newest real command", () => {
    const entries = [
      entry(1, { line: "oled report --json" }),
      entry(2, { line: "oled questions list --json" }),
      entry(3, { line: "oled ingest list --json" }),
    ];
    expect(newestUseful(entries)?.id).toBe(1);
  });

  it("falls back to the newest entry when every one is a poll", () => {
    const entries = [
      entry(1, { line: "oled ingest list" }),
      entry(2, { line: "oled questions list" }),
    ];
    expect(newestUseful(entries)?.id).toBe(2);
  });

  it("finds nothing in an empty log", () => {
    expect(newestUseful([])).toBeUndefined();
  });
});

describe("commandText", () => {
  it("drops the transport flags and keeps the ones that say what ran", () => {
    expect(
      commandText(
        entry(1, {
          line: "oled tx list --json --config /repo/.oled/config.json --account thb:asset:bank --no-color --no-redact",
        }),
      ),
    ).toBe("oled tx list --account thb:asset:bank");
  });
});
