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
 * One ring per process: the graph that records commands differs from the one
 * the reader polls, so two rings would leave it empty; the cursor beside it
 * survives re-evaluation so no seq repeats.
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

  // A start already evicted from the ring must not drop its end: append a new
  // entry so the exit is still recorded.
  entries.push(toEntry(event, ++cursor.seq));
  if (entries.length > CAPACITY) {
    entries.splice(0, entries.length - CAPACITY);
  }
};

export const listCliLog = (after?: number) => ({
  entries: after === undefined ? entries : entries.filter((e) => e.seq > after),
  latest: cursor.seq,
});

/** The cursor survives a wipe, so a poller's old cursor never re-reads a seq. */
export const clearCliLog = (): void => {
  entries.length = 0;
};
