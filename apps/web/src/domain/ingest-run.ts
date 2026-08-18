import { takeRight } from "es-toolkit";

export type RunStatus =
  | "running"
  | "waiting-password"
  | "done"
  | "failed"
  | "cancelled";

/**
 * `tool` is a step the agent took; the rest are the runner's own voice — what
 * it left out, what broke, what it needs, and how the run ended.
 */
export type RunEntryKind = "tool" | "note" | "error" | "ask" | "summary";

export interface RunEntry {
  /** Merge key: a tool call's graph id, so its start and its outcome are one row. */
  readonly id: string;
  readonly seq: number;
  readonly at: number;
  readonly kind: RunEntryKind;
  /** The whole line. Composed from the phase table and the file it names. */
  readonly label: string;
  /** Figures the step returned, never anything it was called with. */
  readonly detail?: string;
  /** Set when the line names a file the viewer can open. */
  readonly fileId?: string;
  /** A step with no outcome yet. */
  readonly running?: boolean;
}

export interface RunWaiting {
  readonly relPath: string;
  readonly message: string;
}

/** What a reader may know about the run. The transcript is not part of it. */
export interface RunSnapshot {
  readonly runId: string;
  readonly status: RunStatus;
  readonly scope: string;
  /** Optional: a run started before this field shipped has none. */
  readonly mode?: RunMode;
  readonly currentFile?: string;
  readonly waiting?: RunWaiting;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

interface Phase {
  readonly live: string;
  readonly done: string;
}

/**
 * One line per tool, in both tenses: a step is journalled when it starts and
 * rewritten when it lands, and a running step must not claim it finished.
 * A tool absent from this table never reaches the feed, which is what keeps
 * the agent's file and todo built-ins out of a log about money.
 */
export const PHASE_LABEL: Record<string, Phase> = {
  ingestList: { live: "Reading the queue", done: "Read the queue" },
  ingestPrepare: { live: "Preparing", done: "Prepared" },
  readDocument: { live: "Reading", done: "Read" },
  ingestCommit: { live: "Posting rows", done: "Posted rows" },
  ingestDone: { live: "Closing", done: "Closed" },
  ingestFail: { live: "Discarding", done: "Discarded" },
  questionsList: {
    live: "Reading open questions",
    done: "Read open questions",
  },
  answerQuestion: { live: "Answering a question", done: "Answered a question" },
  deferQuestion: { live: "Deferring a question", done: "Deferred a question" },
  listAccounts: { live: "Reading the balances", done: "Read the balances" },
};

/**
 * Everything a line is made of joins the same way, so a step with no file and
 * no figures degrades to its verb alone rather than to a dangling preposition.
 */
export const runLine = (...parts: (string | undefined)[]): string =>
  parts.filter((part) => part !== undefined && part.length > 0).join(" · ");

/** A run holds the single slot until it settles, parked included. */
export const isRunLive = (status: RunStatus): boolean =>
  status === "running" || status === "waiting-password";

export const RUN_MODES = ["auto", "normal"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** What the runner can tell the agent about one file before it opens it. */
export interface RunTarget {
  readonly relPath: string;
  readonly status: string;
  readonly fileId: string | null;
  /** The extracted text exists. A file id alone does not say that it does. */
  readonly prepared: boolean;
}

const preparedNote = (target: RunTarget): string | undefined => {
  if (target.fileId === null) return undefined;
  return target.prepared
    ? `already prepared as ${target.fileId}, do not prepare it again`
    : "registered with nothing extracted, so prepare it again before reading it";
};

/**
 * The one line the two modes differ by. Auto finishes the queue alone. Normal
 * hands the ambiguous back: a file whose questions are still open is not
 * finished, and closing it would bury the ask behind an ingested status
 * nobody looks at again.
 */
const CLOSING_RULE: Record<RunMode, string> = {
  auto: "Post every one of them, close each file, answer the questions they raise, then report.",
  normal:
    "Post every one of them. The questions the ledger raises stay open for the operator: do not answer them, do not defer them, and do not close a file that has open questions — report that file as waiting for clarification instead. Close the files that raised none, then report.",
};

export const objectiveOf = (
  targets: readonly RunTarget[],
  mode: RunMode,
): string =>
  [
    "Work the ingest queue. These files are in scope, and nothing else is:",
    ...targets.map(
      (target) =>
        `- ${runLine(target.relPath, target.status, preparedNote(target))}`,
    ),
    CLOSING_RULE[mode],
  ].join("\n");

/** The server ring's own capacity, restated: it cannot be imported client-side. */
const WINDOW = 300;

export const NO_RUN_ENTRIES: RunEntry[] = [];

/**
 * A step is rewritten in place when it lands, so the same id arrives twice and
 * the later read takes the earlier one's slot rather than appending.
 */
export const mergeRunEntries = (
  current: readonly RunEntry[],
  delta: readonly RunEntry[],
): RunEntry[] => {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of delta) byId.set(entry.id, entry);
  return takeRight([...byId.values()], WINDOW);
};
