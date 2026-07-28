import { takeRight } from "es-toolkit";

import type { RouterOutputs } from "@openledger-fleet/api";

/** One shape for a CLI log entry, derived from the read that produces it. */
export type CliEntry = RouterOutputs["ledger"]["cliLog"]["entries"][number];

/**
 * The server's ring holds 200 invocations. It cannot be imported from here —
 * that package reaches the `oled` connector and would follow into the browser
 * bundle — so the number is restated rather than shared.
 */
const WINDOW = 200;

/**
 * A stable reference, so a missing read does not allocate a fresh array
 * identity on every render.
 */
export const NO_ENTRIES: CliEntry[] = [];

/**
 * An invocation is rewritten in place when it exits, so the same id arrives
 * twice and the later read takes the earlier one's slot rather than appending.
 * The window is the server ring's, so a long session never holds more than the
 * server remembers.
 */
export const mergeCliLog = (
  current: readonly CliEntry[],
  delta: readonly CliEntry[],
): CliEntry[] => {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of delta) byId.set(entry.id, entry);
  return takeRight([...byId.values()], WINDOW);
};
