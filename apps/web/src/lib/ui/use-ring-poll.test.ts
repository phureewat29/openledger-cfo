import { describe, expect, it } from "vitest";

import { mergeById } from "./use-ring-poll";

interface Entry {
  readonly id: number;
  readonly exitCode: number | null;
}

const entry = (id: number, exitCode: number | null = 0): Entry => ({
  id,
  exitCode,
});

const ids = (entries: readonly Entry[]) => entries.map((item) => item.id);

describe("mergeById", () => {
  it("lets a later read of an id replace it in its original slot", () => {
    const merged = mergeById(
      [entry(1), entry(2, null)],
      [entry(2, 3), entry(3)],
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
    const delta = [entry(1, 1)];
    mergeById(current, delta, 10);
    expect(current[0]?.exitCode).toBe(0);
    expect(delta).toHaveLength(1);
  });
});
