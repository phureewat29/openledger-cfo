import type { OledCommandEvent } from "@openledger-cfo/openledger";

import { perProcess } from "./per-process";

/** Exported for declaration emit only: it prints inside `ledgerRouter`'s type. */
export interface CliLogEntry {
  id: number;
  seq: number;
  startedAt: number;
  line: string;
  exitCode: number | null;
  durationMs: number | null;
}

const CAPACITY = 200;

interface CliLog {
  entries: CliLogEntry[];
  /** The last seq handed out, kept beside the ring so no seq ever repeats. */
  seq: number;
}

/**
 * One ring per process: the graph that records commands differs from the one
 * the reader polls, so two rings would leave it empty.
 */
const log = perProcess<CliLog>("oledCliRing", () => ({ entries: [], seq: 0 }));

/**
 * Both phases carry the whole invocation, so one shape serves either: a start
 * has no exit code and no duration, which is exactly what a running entry
 * holds, and subtracting an absent duration leaves its own timestamp.
 */
const toEntry = (event: OledCommandEvent, seq: number): CliLogEntry => ({
  id: event.id,
  seq,
  startedAt: event.ts - (event.durationMs ?? 0),
  line: `oled ${event.argv.join(" ")}`,
  exitCode: event.exitCode ?? null,
  durationMs: event.durationMs ?? null,
});

export const recordCliCommand = (event: OledCommandEvent): void => {
  const running =
    event.phase === "end"
      ? log.entries.find((entry) => entry.id === event.id)
      : undefined;

  if (running !== undefined) {
    // An exit rewrites an entry a reader has already been handed, so it takes a
    // fresh seq to come back past that reader's cursor.
    running.seq = ++log.seq;
    running.exitCode = event.exitCode ?? null;
    running.durationMs = event.durationMs ?? null;
    return;
  }

  // A start already evicted from the ring must not drop its end: append a new
  // entry so the exit is still recorded.
  log.entries.push(toEntry(event, ++log.seq));
  if (log.entries.length > CAPACITY) {
    log.entries.splice(0, log.entries.length - CAPACITY);
  }
};

export const listCliLog = (after?: number) => ({
  entries:
    after === undefined
      ? log.entries
      : log.entries.filter((entry) => entry.seq > after),
  latest: log.seq,
});
