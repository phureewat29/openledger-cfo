import type { OledCommandEvent } from "@openledger-fleet/openledger";

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

/**
 * One ring per process, for the same reason the connector is one per process:
 * Next instantiates this module once per module graph, and the commands are
 * recorded from the graph that renders while the reader polls from the graph
 * that answers the request. Two rings means the reader watches an empty one.
 * The cursor sits beside it so a re-evaluated module cannot hand out a seq the
 * ring has already used.
 */
const forRing = globalThis as unknown as {
  oledCliLog?: CliLogEntry[];
  oledCliLogCursor?: { seq: number };
};

const entries = (forRing.oledCliLog ??= []);
const cursor = (forRing.oledCliLogCursor ??= { seq: 0 });

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

export const recordCliCommand = (event: OledCommandEvent) => {
  const running =
    event.phase === "end"
      ? entries.find((entry) => entry.id === event.id)
      : undefined;

  if (running !== undefined) {
    // An exit rewrites an entry a reader has already been handed, so it takes a
    // fresh seq to come back past that reader's cursor.
    running.seq = ++cursor.seq;
    running.exitCode = event.exitCode ?? null;
    running.durationMs = event.durationMs ?? null;
    return;
  }

  // An end whose start the ring has already evicted must still leave the exit
  // behind: a reader handed that start is showing it as running, and the only
  // thing that can settle the row is another entry under the same id, which is
  // what the reader merges by. So an end never returns empty-handed — it
  // appends what it knows, which is everything the start knew plus the exit.
  entries.push(toEntry(event, ++cursor.seq));
  if (entries.length > CAPACITY) {
    entries.splice(0, entries.length - CAPACITY);
  }
};

export const listCliLog = (after?: number) => ({
  entries: after === undefined ? entries : entries.filter((e) => e.seq > after),
  latest: cursor.seq,
});
