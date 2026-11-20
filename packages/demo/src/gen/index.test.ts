import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { LIFE_PATH } from "../dataset";
import { checkInvariants } from "../invariants";
import { buildLife } from "./index";

const CONTEXT = 60;

const committed = readFileSync(LIFE_PATH, "utf8");
const { meta } = z
  .object({ meta: z.object({ variant: z.number() }) })
  .parse(JSON.parse(committed));

const firstDifference = (actual: string, expected: string): number => {
  const shared = Math.min(actual.length, expected.length);
  for (let offset = 0; offset < shared; offset += 1) {
    if (actual[offset] !== expected[offset]) return offset;
  }
  return actual.length === expected.length ? -1 : shared;
};

/** Empty when equal; otherwise where the texts first part, with a little context. */
const describeDrift = (actual: string, expected: string): string => {
  const offset = firstDifference(actual, expected);
  if (offset < 0) return "";
  const around = (text: string): string =>
    text.slice(Math.max(0, offset - CONTEXT), offset + CONTEXT);
  return `first difference at offset ${String(offset)} of ${String(expected.length)}\n  built:     ${around(actual)}\n  committed: ${around(expected)}`;
};

describe(`buildLife(${String(meta.variant)})`, () => {
  const life = buildLife(meta.variant);

  it("reproduces the committed dataset byte for byte", () => {
    expect(describeDrift(JSON.stringify(life), committed)).toBe("");
  });

  it("passes every invariant", () => {
    expect(checkInvariants(life).filter((entry) => !entry.ok)).toEqual([]);
  });
});
