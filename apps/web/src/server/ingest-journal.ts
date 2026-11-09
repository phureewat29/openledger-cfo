import { takeRight } from "es-toolkit";

import { perProcess } from "@openledger-cfo/db";

import type { RunEntry } from "~/domain/ingest-run";
import { RUN_JOURNAL_CAPACITY } from "~/domain/ingest-run";

/** The ring and the last seq it handed out, swapped together as one value. */
interface Journal {
  readonly entries: readonly RunEntry[];
  readonly seq: number;
}

type NewEntry = Omit<RunEntry, "seq" | "at">;
type EntryPatch = Partial<Omit<RunEntry, "id" | "seq" | "at">>;

const appended = (journal: Journal, entry: NewEntry, at: number): Journal => {
  const seq = journal.seq + 1;
  return {
    entries: takeRight(
      [...journal.entries, { ...entry, seq, at }],
      RUN_JOURNAL_CAPACITY,
    ),
    seq,
  };
};

/**
 * A step that lands rewrites a row the reader has already been handed, so it
 * takes a fresh seq to come back past that reader's cursor. Its slot does not
 * move: the feed is ordered by when work started, not by when it finished.
 */
const patched = (journal: Journal, id: string, patch: EntryPatch): Journal => {
  const index = journal.entries.findIndex((entry) => entry.id === id);
  const current = journal.entries[index];
  if (current === undefined) return journal;
  const seq = journal.seq + 1;
  return {
    entries: journal.entries.with(index, { ...current, ...patch, seq }),
    seq,
  };
};

/**
 * One journal per process, for the reason the command log has one: the runner
 * writes from a detached turn while the reader polls from a request, and two
 * copies would leave the reader watching an empty one. The seq lives in the
 * same value so a re-evaluated module cannot hand out one already used.
 */
const holder = perProcess<{ current: Journal }>("ingestRunJournal", () => ({
  current: { entries: [], seq: 0 },
}));

export const appendEntry = (entry: NewEntry): void => {
  holder.current = appended(holder.current, entry, Date.now());
};

export const updateEntry = (id: string, patch: EntryPatch): void => {
  holder.current = patched(holder.current, id, patch);
};

export const listEntries = (after?: number) => {
  const { entries, seq } = holder.current;
  return {
    entries:
      after === undefined
        ? entries
        : entries.filter((entry) => entry.seq > after),
    latest: seq,
  };
};
