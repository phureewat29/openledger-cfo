import { range } from "es-toolkit";
import { describe, expect, it } from "vitest";

import type { RunEntry } from "./ingest-run";
import { mergeRunEntries, RUN_JOURNAL_CAPACITY } from "./ingest-run";

const entry = (id: string, overrides: Partial<RunEntry> = {}): RunEntry => ({
  id,
  seq: 0,
  at: 0,
  kind: "tool",
  label: id,
  ...overrides,
});

describe("mergeRunEntries", () => {
  it("rewrites a tool's start with its outcome in the same row", () => {
    const merged = mergeRunEntries(
      [entry("a"), entry("call-1", { label: "Reading", running: true })],
      [entry("call-1", { label: "Read" }), entry("b")],
    );
    expect(merged.map((item) => item.id)).toEqual(["a", "call-1", "b"]);
    expect(merged[1]).toEqual(entry("call-1", { label: "Read" }));
  });

  it("never outgrows the server journal", () => {
    const current = range(RUN_JOURNAL_CAPACITY).map((n) => entry(String(n)));
    const merged = mergeRunEntries(current, [entry("next")]);
    expect(merged).toHaveLength(RUN_JOURNAL_CAPACITY);
    expect(merged[0]?.id).toBe("1");
    expect(merged.at(-1)?.id).toBe("next");
  });
});
