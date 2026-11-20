import type { OledCommandEvent } from "@openledger-cfo/openledger";
import { perProcess } from "@openledger-cfo/db";

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

const log = perProcess<CliLog>("oledCliRing", () => ({ entries: [], seq: 0 }));

// A start has no duration, so its own timestamp is when it started.
const toEntry = (event: OledCommandEvent, seq: number): CliLogEntry => ({
  id: event.id,
  seq,
  startedAt: event.ts - (event.durationMs ?? 0),
  line: `oled ${event.argv.join(" ")}`,
  exitCode: event.exitCode ?? null,
  durationMs: event.durationMs ?? null,
});

// An exit takes a fresh seq so it passes a reader's cursor again; one whose
// start has left the ring lands as a new entry.
export const recordCliCommand = (event: OledCommandEvent): void => {
  const seq = ++log.seq;
  const running =
    event.phase === "end"
      ? log.entries.find((entry) => entry.id === event.id)
      : undefined;

  if (running === undefined) {
    log.entries = [...log.entries, toEntry(event, seq)].slice(-CAPACITY);
    return;
  }

  const ended: CliLogEntry = {
    ...running,
    seq,
    exitCode: event.exitCode ?? null,
    durationMs: event.durationMs ?? null,
  };
  log.entries = log.entries.map((entry) => (entry === running ? ended : entry));
};

export const listCliLog = (after?: number) => ({
  entries:
    after === undefined
      ? log.entries
      : log.entries.filter((entry) => entry.seq > after),
  latest: log.seq,
});
