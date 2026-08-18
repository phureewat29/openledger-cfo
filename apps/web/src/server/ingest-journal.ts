import type { RunEntry } from "~/domain/ingest-run";

const CAPACITY = 300;

/**
 * One ring per process, for the reason the command log has one: the runner
 * writes from a detached turn while the reader polls from a request, and two
 * rings would leave the reader watching an empty one. The cursor sits beside it
 * so a re-evaluated module cannot hand out a seq the ring has already used.
 */
const forRing = globalThis as unknown as {
  ingestJournal?: RunEntry[];
  ingestJournalCursor?: { seq: number };
};

const entries = (forRing.ingestJournal ??= []);
const cursor = (forRing.ingestJournalCursor ??= { seq: 0 });

type NewEntry = Omit<RunEntry, "seq" | "at">;
type EntryPatch = Partial<Omit<RunEntry, "id" | "seq" | "at">>;

export const appendEntry = (entry: NewEntry): void => {
  entries.push({ ...entry, seq: ++cursor.seq, at: Date.now() });
  if (entries.length > CAPACITY) {
    entries.splice(0, entries.length - CAPACITY);
  }
};

/**
 * A step that lands rewrites a row the reader has already been handed, so it
 * takes a fresh seq to come back past that reader's cursor. Its slot does not
 * move: the feed is ordered by when work started, not by when it finished.
 */
export const updateEntry = (id: string, patch: EntryPatch): void => {
  const index = entries.findIndex((entry) => entry.id === id);
  const current = entries[index];
  if (current === undefined) return;
  entries[index] = { ...current, ...patch, seq: ++cursor.seq };
};

export const listEntries = (after?: number) => ({
  entries:
    after === undefined
      ? entries
      : entries.filter((entry) => entry.seq > after),
  latest: cursor.seq,
});

/** The cursor survives a wipe, so a poller's old cursor never re-reads a seq. */
export const clearEntries = (): void => {
  entries.length = 0;
};
