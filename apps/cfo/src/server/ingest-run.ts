import type { UIMessage } from "ai";
import { TRPCError } from "@trpc/server";
import { partition, uniqBy } from "es-toolkit";

import type { LangGraphEvent } from "@openledger-fleet/agent";
import type { Result } from "@openledger-fleet/openledger";
import {
  createAgent,
  isAiEnabled,
  nsDepth,
  textOf,
  unwrap,
} from "@openledger-fleet/agent";
import { appRouter, createTRPCContext } from "@openledger-fleet/api";
import { err, ok } from "@openledger-fleet/openledger";

import type { IngestFile } from "~/domain/ingest-files";
import type {
  RunMode,
  RunSnapshot,
  RunStatus,
  RunTarget,
  RunWaiting,
} from "~/domain/ingest-run";
import { countNoun } from "~/domain/format";
import { openQuestionsByFile, WORKABLE } from "~/domain/ingest-files";
import {
  isRunLive,
  objectiveOf,
  PHASE_LABEL,
  runLine,
} from "~/domain/ingest-run";
import { appendEntry, updateEntry } from "~/server/ingest-journal";

/**
 * The run outlives the request, so it cannot borrow the request-scoped caller
 * (it reads `headers()` and throws once detached) — this one shares the
 * connector, so commands still land in the same lanes and log.
 */
const caller = appRouter.createCaller(
  createTRPCContext({ headers: new Headers() }),
);

export type RunScope =
  | { readonly pathOrId: string }
  | { readonly pathOrIds: readonly string[] };

export type StartFailure = "disabled" | "busy" | "unavailable";

export type StartResult = Result<
  { runId: string },
  { reason: StartFailure; message: string }
>;

export type RunCommandResult = Result<undefined, { message: string }>;

/** The two names a locked file answers to, and neither of them is its password. */
interface Lockable {
  /** What ingestPrepare is retried with — a path or an id, never the password. */
  readonly pathOrId: string;
  readonly relPath: string;
}

interface Waiting extends RunWaiting, Lockable {}

interface Run {
  readonly runId: string;
  readonly scope: string;
  readonly mode: RunMode;
  readonly startedAt: number;
  readonly abort: AbortController;
  /** File id → the name the operator dropped, so later lines can say it back. */
  readonly names: Map<string, string>;
  /**
   * Every name this run's files answer to: the paths it was handed, plus the
   * ids its own prepares gave them. The agent does wander into files nobody
   * asked for — being worked is not the test, being asked for is.
   */
  readonly own: Set<string>;
  /** Consecutive closes the ledger turned down, per file. */
  readonly refusedCloses: Map<string, number>;
  /** Prepares this run has spent trying its password on a file, per file. */
  readonly unlockAttempts: Map<string, number>;
  /**
   * What the run changed, said back when it settles. Sets, not counters: a
   * supervised close and the model's idempotent retry are one closed file.
   * Only files the run was asked for count — the agent does wander.
   */
  readonly tally: {
    readonly closed: Set<string>;
    readonly discarded: Set<string>;
    rows: number;
  };
  status: RunStatus;
  files: number;
  currentFile?: string;
  /**
   * The password the operator typed, kept for this run's other locked files and
   * nothing else: it reaches `oled` as one masked argv and never the transcript,
   * the journal or a snapshot.
   */
  password?: string;
  waiting?: Waiting;
  finishedAt?: number;
  transcript: UIMessage[];
}

/** One slot per process: a second start is refused rather than queued. */
const forSlot = globalThis as unknown as {
  ingestRunSlot?: { run: Run | null };
};
const slot = (forSlot.ingestRunSlot ??= { run: null });

/** The reset hatch drops whatever the slot holds, aborting a run still live. */
export const resetRunSlot = (): void => {
  const current = slot.run;
  if (current !== null && isRunLive(current.status)) current.abort.abort();
  slot.run = null;
};

/** Graph supersteps, not model turns: one statement costs a dozen round trips. */
const recursionLimitFor = (files: number): number =>
  Math.min(64 + 40 * (files - 1), 320);

const FILE_BUDGET_MS = 15 * 60_000;
const BUDGETED_FILES = 6;

/** Wall clock, so a stalled gateway cannot hold the slot until a restart. */
const budgetFor = (files: number): number =>
  Math.min(files, BUDGETED_FILES) * FILE_BUDGET_MS;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
};

/** The graph hands a tool's arguments over as a JSON string nested in `input`. */
const inputOf = (event: LangGraphEvent): Record<string, unknown> => {
  const wrapper = asRecord(event.data?.input);
  const raw = wrapper.input;
  return typeof raw === "string" ? asRecord(parseJson(raw)) : wrapper;
};

/**
 * The only two fields anything here reads: which statement a step is about.
 * No other field of a tool's input is looked at or kept — a password stays
 * out of the journal's reach by construction.
 */
const targetOf = (input: Record<string, unknown>): string | undefined => {
  const target = asString(input.pathOrId) || asString(input.fileId);
  return target.length === 0 ? undefined : target;
};

const FILE_ID_PREFIX = "sf-";

const asFileId = (value: string | undefined): string | undefined =>
  value?.startsWith(FILE_ID_PREFIX) === true ? value : undefined;

const displayOf = (
  run: Run,
  target: string | undefined,
): string | undefined => {
  if (target === undefined) return undefined;
  const known = run.names.get(target);
  if (known !== undefined) return known;
  if (target.startsWith(FILE_ID_PREFIX)) return `…${target.slice(-6)}`;
  return target.split("/").pop() ?? target;
};

const countOf = (
  value: unknown,
  one: string,
  many: string,
): string | undefined =>
  typeof value === "number" ? countNoun(value, one, many) : undefined;

/**
 * The only result fields a line may quote: what was read and what was posted.
 * A tool's arguments are never serialized here, so there is no path by which
 * a password could reach a journal entry.
 */
const detailOf = (artifact: Record<string, unknown>): string | undefined => {
  const summary = asRecord(artifact.summary);
  const duplicates =
    typeof summary.duplicates === "number" && summary.duplicates > 0
      ? countOf(summary.duplicates, "duplicate", "duplicates")
      : undefined;
  const detail = runLine(
    countOf(artifact.page_count, "page", "pages"),
    countOf(summary.posted, "row posted", "rows posted"),
    duplicates,
  );
  return detail.length === 0 ? undefined : detail;
};

const fileIdOf = (artifact: Record<string, unknown>): string | undefined =>
  asFileId(asString(artifact.file_id)) ??
  asFileId(asString(asRecord(artifact.summary).file_id));

interface Refusal {
  readonly label: string;
  readonly detail: string;
}

/**
 * Two steps can be turned down and still answer with an artifact — a close
 * whose balance does not tie, a commit where only some rows posted. Neither
 * did what its finished tense claims, so neither is written in it.
 */
const REFUSAL: Record<string, Refusal> = {
  mismatch: {
    label: "Close refused",
    detail: "the closing balance did not match the ledger",
  },
  partial: { label: "Rows refused", detail: "some rows did not post" },
};

const refusalOf = (artifact: Record<string, unknown>): Refusal | undefined =>
  typeof artifact.reason === "string" ? REFUSAL[artifact.reason] : undefined;

/** What each landed step adds to the tally; a tool absent here changes nothing. */
const TALLY_OF: Record<
  string,
  (
    run: Run,
    artifact: Record<string, unknown>,
    fileId: string | undefined,
  ) => void
> = {
  ingestDone: (run, _artifact, fileId) => {
    if (fileId !== undefined && run.own.has(fileId)) {
      run.tally.closed.add(fileId);
    }
  },
  ingestFail: (run, _artifact, fileId) => {
    if (fileId !== undefined && run.own.has(fileId)) {
      run.tally.discarded.add(fileId);
    }
  },
  ingestCommit: (run, artifact, fileId) => {
    if (fileId === undefined || !run.own.has(fileId)) return;
    const posted = asRecord(artifact.summary).posted;
    if (typeof posted === "number") run.tally.rows += posted;
  },
};

const tallySaid = (tally: Run["tally"]): string => {
  const said = runLine(
    tally.closed.size > 0 ? `closed ${String(tally.closed.size)}` : undefined,
    tally.discarded.size > 0
      ? `discarded ${String(tally.discarded.size)}`
      : undefined,
    tally.rows > 0 ? `posted ${countNoun(tally.rows, "row")}` : undefined,
  );
  return said.length === 0 ? "nothing changed" : said;
};

/**
 * Some models will not take the prompt's escape — closing on file id alone —
 * when the balance cannot tie, looping until steps run out and leaving a
 * posted file stuck. Twice is enough to know this one will not take it.
 */
const REFUSED_CLOSE_LIMIT = 2;

const RECONCILE_SKIPPED =
  "reconcile skipped — the ledger holds history the statement does not";

const MAX_DETAIL_CHARS = 200;

const firstLine = (text: string): string | undefined => {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length === 0 ? undefined : line.slice(0, MAX_DETAIL_CHARS);
};

const note = (label: string, detail?: string): void => {
  appendEntry({ id: crypto.randomUUID(), kind: "note", label, detail });
};

const message = (role: "user" | "assistant", text: string): UIMessage => ({
  id: crypto.randomUUID(),
  role,
  parts: [{ type: "text", text }],
});

/**
 * A file id alone does not say whether a file is prepared — a locked prepare
 * registers it anyway, and closing deletes its text. This opens the artifact
 * rather than spawning a command, so it is affordable once per file.
 */
const hasDocument = async (fileId: string): Promise<boolean> => {
  try {
    await caller.ledger.ingest.document({ fileId });
    return true;
  } catch (cause) {
    // Only a missing extraction means "not prepared"; anything else is real.
    if (cause instanceof TRPCError && cause.code === "NOT_FOUND") return false;
    throw cause;
  }
};

const targetOfRow = async (row: IngestFile): Promise<RunTarget> => {
  const prepared = row.file_id !== null && (await hasDocument(row.file_id));
  return {
    relPath: row.rel_path,
    status: row.status,
    fileId: row.file_id,
    prepared,
  };
};

/**
 * The queue is a snapshot the operator worked from, so a name it no longer
 * holds is still work: a file registered a moment ago reads as new here and
 * the agent finds it where it lies.
 */
const targetOfName = async (
  name: string,
  rows: IngestFile[],
): Promise<RunTarget> => {
  const row = rows.find(
    (candidate) =>
      candidate.rel_path === name ||
      candidate.path === name ||
      candidate.file_id === name,
  );
  if (row !== undefined) return targetOfRow(row);
  return { relPath: name, status: "new", fileId: null, prepared: false };
};

/** Named files are worked whatever state they are in; a locked one parks the run. */
const selectTargets = async (
  scope: RunScope,
  rows: IngestFile[],
): Promise<RunTarget[]> => {
  if ("pathOrId" in scope) return [await targetOfName(scope.pathOrId, rows)];
  return Promise.all(scope.pathOrIds.map((name) => targetOfName(name, rows)));
};

/**
 * What a Normal run leaves behind, said in the feed rather than left for the
 * operator to notice: the file is posted and still open because its questions
 * are the operator's to answer.
 */
const noteClarifications = async (): Promise<void> => {
  const [files, questions] = await Promise.all([
    caller.ledger.ingest.list().then(
      (page) => page.rows,
      () => undefined,
    ),
    caller.ledger.questions.list({}).then(
      (page) => page.rows,
      () => undefined,
    ),
  ]);
  if (files === undefined || questions === undefined) {
    note("Skipped the clarification check", "the ledger did not answer");
    return;
  }

  const openByFile = openQuestionsByFile(questions);

  const waiting = files.flatMap((row) => {
    if (row.status !== "pending" || row.file_id === null) return [];
    const open = openByFile[row.file_id] ?? 0;
    return open === 0 ? [] : [{ relPath: row.rel_path, open }];
  });

  for (const file of waiting) {
    note(
      runLine(file.relPath, "has open questions"),
      countOf(file.open, "open question", "open questions"),
    );
  }
};

const settle = (run: Run, status: RunStatus): void => {
  run.status = status;
  run.finishedAt = Date.now();
  run.currentFile = undefined;
  run.waiting = undefined;
  // A finished run lingers in the slot until the next start; its password does not.
  run.password = undefined;
};

const park = (run: Run, waiting: Waiting): void => {
  run.status = "waiting-password";
  run.waiting = waiting;
  run.currentFile = waiting.relPath;
  appendEntry({
    id: crypto.randomUUID(),
    kind: "ask",
    label: runLine(waiting.relPath, "needs its password"),
    detail: waiting.message,
  });
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isTimeout = (cause: unknown): boolean =>
  cause instanceof Error &&
  (cause.name === "TimeoutError" || cause.name === "AbortError");

const settleCancelled = (run: Run): void => {
  settle(run, "cancelled");
  note(
    "Run cancelled. Whatever it already closed stays closed.",
    tallySaid(run.tally),
  );
};

/**
 * Every way a turn can end badly, said plainly — and with the tally, because
 * a stopped run is exactly when the operator needs to know what landed. The
 * files themselves are whatever `oled` last recorded.
 */
const settleFailure = (run: Run, cause: unknown): void => {
  if (run.abort.signal.aborted) {
    settleCancelled(run);
    return;
  }
  if (cause instanceof Error && cause.name === "GraphRecursionError") {
    settle(run, "failed");
    note(
      "Run stopped — it reached its step limit. Select what is still open and press Ingest again.",
      tallySaid(run.tally),
    );
    return;
  }
  if (isTimeout(cause)) {
    settle(run, "failed");
    note(
      `Run stopped — it passed its ${String(budgetFor(run.files) / 60_000)} minute limit. Select what is still open and press Ingest again.`,
      tallySaid(run.tally),
    );
    return;
  }
  settle(run, "failed");
  note("Run failed.", messageOf(cause));
  note("Run stopped", tallySaid(run.tally));
};

interface Unlocked {
  readonly relPath: string;
  readonly fileId: string;
}

/**
 * One prepare with the password the run holds, and the bookkeeping that makes
 * the file this run's own. Every failure comes back as a value: the route
 * behind `submitPassword` would turn a throw into a 500 and leave the run
 * `running` with no turn in flight to run it.
 */
const tryUnlock = async (
  run: Run,
  { pathOrId, relPath }: Lockable,
): Promise<Result<Unlocked, { message: string }>> => {
  const prepared = await caller.ledger.ingest
    .prepare({ pathOrId, password: run.password })
    .catch((cause: unknown) => ({
      ok: false as const,
      message: messageOf(cause),
    }));
  if (!prepared.ok) return err({ message: prepared.message });

  run.names.set(prepared.file_id, relPath);
  run.own.add(prepared.file_id);
  appendEntry({
    id: crypto.randomUUID(),
    kind: "tool",
    label: runLine("Unlocked and prepared", relPath),
    detail: countOf(prepared.page_count, "page", "pages"),
    fileId: prepared.file_id,
  });
  return ok({ relPath, fileId: prepared.file_id });
};

interface Sweep {
  readonly unlocked: Unlocked[];
  /** What the password did not open, each carrying what the ledger said of it. */
  readonly locked: Waiting[];
}

/**
 * A file may be named by rel_path in one turn and by its sf- id in the next;
 * the attempt ledger counts them as one file, not two.
 */
const attemptKeyOf = (run: Run, pathOrId: string): string =>
  run.names.get(pathOrId) ?? pathOrId;

/**
 * One file at a time: a prepare is minutes of OCR on the write lane, and the
 * gap between two of them is the only place a cancel can be noticed — no turn
 * is in flight to carry one.
 */
const unlockEach = async (
  run: Run,
  files: readonly Lockable[],
): Promise<Sweep> => {
  const unlocked: Unlocked[] = [];
  const locked: Waiting[] = [];
  for (const file of files) {
    if (run.abort.signal.aborted) break;
    run.currentFile = file.relPath;
    const key = attemptKeyOf(run, file.pathOrId);
    run.unlockAttempts.set(key, (run.unlockAttempts.get(key) ?? 0) + 1);
    const out = await tryUnlock(run, file);
    if (out.ok) unlocked.push(out.value);
    else locked.push({ ...file, message: out.error.message });
  }
  return { unlocked, locked };
};

/**
 * Two tries per file for the whole run: every unlock hands the model a fresh
 * turn with a fresh budget, so a model that keeps re-preparing one file without
 * its password would otherwise be unlocked and advanced without end.
 */
const UNLOCK_ATTEMPT_LIMIT = 2;

/**
 * What the password already in hand can do about a turn that ended on locks.
 * No `own` gate on purpose: a locked file the model wandered into is still the
 * operator's to unlock — scope discipline is the objective's job, not the
 * password's.
 */
const autoUnlock = async (
  run: Run,
  files: readonly Waiting[],
): Promise<Sweep> => {
  if (run.password === undefined) return { unlocked: [], locked: [...files] };

  const [tried, spent] = partition(
    files,
    (file) =>
      (run.unlockAttempts.get(attemptKeyOf(run, file.pathOrId)) ?? 0) <
      UNLOCK_ATTEMPT_LIMIT,
  );
  const swept = await unlockEach(run, tried);
  return { unlocked: swept.unlocked, locked: [...swept.locked, ...spent] };
};

interface LockedScan {
  /** Encrypted files whose text is already extracted and readable. */
  readonly prepared: Unlocked[];
  /** Encrypted files still without an extraction, by the name a prepare takes. */
  readonly locked: Lockable[];
}

/** This run's encrypted files, split by whether their text is already served. */
const scanLocked = async (run: Run): Promise<LockedScan> => {
  const page = await caller.ledger.ingest.list().catch(() => null);
  const mine = (page?.rows ?? []).filter(
    (row) =>
      row.encrypted &&
      WORKABLE.has(row.status) &&
      (run.own.has(row.rel_path) ||
        (row.file_id !== null && run.own.has(row.file_id))),
  );

  const prepared: Unlocked[] = [];
  const locked: Lockable[] = [];
  for (const row of mine) {
    // A cache read the ledger will not serve leaves the file to a prepare.
    if (
      row.file_id !== null &&
      (await hasDocument(row.file_id).catch(() => false))
    ) {
      prepared.push({ relPath: row.rel_path, fileId: row.file_id });
      continue;
    }
    // By `rel_path`: a locked file no prepare has registered has no id to send.
    locked.push({ pathOrId: row.rel_path, relPath: row.rel_path });
  }
  return { prepared, locked };
};

/**
 * The rest of this run's locked files, opened with the password now in hand —
 * a bank issues a year of statements under one password, so the operator types
 * it once. What comes back is everything the model may now read, files an
 * earlier unlock already prepared included.
 */
const unlockRest = async (run: Run, first: Unlocked): Promise<Unlocked[]> => {
  const scan = await scanLocked(run);
  const swept = await unlockEach(
    run,
    // `first` is prepared by definition, and a second prepare is OCR twice.
    scan.locked.filter((file) => file.relPath !== first.relPath),
  );
  // A file the password did not open would otherwise surface a turn later,
  // after the model burns its second attempt on it.
  for (const file of swept.locked) {
    note(runLine(file.relPath, "did not open"), firstLine(file.message));
  }
  return [first, ...scan.prepared, ...swept.unlocked];
};

/**
 * Every file the model may now read, named with the id its prepare returned:
 * without the id it re-prepares, and a second prepare of a locked file asks for
 * the password all over again. Deduped here because `oled` collapses identical
 * bytes to one id, so two rel_paths can arrive as one file.
 */
const continuationFor = (unlocked: readonly Unlocked[]): string => {
  const files = uniqBy([...unlocked], (file) => file.fileId);
  const named = files
    .map((file) => `- ${file.relPath} is prepared as ${file.fileId}`)
    .join("\n");
  return `The operator's password unlocked ${countNoun(files.length, "file")}; every one of them is prepared already, so do not prepare any of them again:\n${named}\n\nRead each one, post its rows and close it, then finish the rest of the queue.`;
};

/**
 * How a turn that ended on locked files goes on: the password opens what it can
 * and the model is handed straight back the files it may now read, and whatever
 * is still locked is the operator's to type for.
 */
const unlockOrPark = async (
  run: Run,
  locked: readonly Waiting[],
): Promise<void> => {
  const swept = await autoUnlock(run, locked);
  if (run.abort.signal.aborted) {
    settleCancelled(run);
    return;
  }

  // What opened outranks what parked: files the password already paid to
  // prepare must reach the model now — a park can end in Skip or Cancel, and
  // either would strand them. The still-locked re-surface next turn, bounded
  // by the attempt cap.
  if (swept.unlocked.length > 0) {
    advance(run, continuationFor(swept.unlocked));
    return;
  }
  const first = swept.locked[0];
  if (first !== undefined) park(run, first);
};

/**
 * Closes the file the agent will not, exactly at the limit and never past it:
 * once this has run the statement is closed, and further refusals are the model
 * arguing with a file it has already finished.
 */
const superviseClose = async (
  run: Run,
  fileId: string,
  name: string | undefined,
): Promise<void> => {
  const refused = (run.refusedCloses.get(fileId) ?? 0) + 1;
  run.refusedCloses.set(fileId, refused);
  if (refused !== REFUSED_CLOSE_LIMIT) return;

  try {
    const out = await caller.ledger.ingest.done({ fileId });
    // A refusal here means the model's next fileId-only retry can still land.
    if (out.ok) {
      if (run.own.has(fileId)) run.tally.closed.add(fileId);
      note(runLine("Closed", name), RECONCILE_SKIPPED);
    }
  } catch (cause) {
    note(
      runLine("Close failed", name),
      cause instanceof Error ? firstLine(cause.message) : undefined,
    );
  }
};

interface OpenCall {
  readonly tool: string;
  readonly name?: string;
  readonly target?: string;
}

/** Normal mode is enforced by taking the tools away, not by asking. */
const QUESTION_TOOLS = ["answerQuestion", "deferQuestion"];

const runTurn = async (run: Run): Promise<void> => {
  const agent = createAgent("ingest", {
    recursionLimit: recursionLimitFor(run.files),
    excludeTools: run.mode === "normal" ? QUESTION_TOOLS : undefined,
    // A question's file is an sf- id, so the paths in here never match one.
    questionFileIds: () => run.own,
  });
  const signal = AbortSignal.any([
    run.abort.signal,
    AbortSignal.timeout(budgetFor(run.files)),
  ]);

  const open = new Map<string, OpenCall>();
  const locked = new Map<string, Waiting>();
  const said: string[] = [];
  let turnText = "";

  const startCall = (event: LangGraphEvent): void => {
    const tool = asString(event.name);
    const phase = PHASE_LABEL[tool];
    const id = asString(event.run_id);
    if (phase === undefined || id.length === 0) return;

    const target = targetOf(inputOf(event));
    const name = displayOf(run, target);
    open.set(id, { tool, name, target });
    if (name !== undefined) run.currentFile = name;
    appendEntry({
      id,
      kind: "tool",
      running: true,
      label: runLine(phase.live, name),
      fileId: asFileId(target),
    });
  };

  const endCall = async (event: LangGraphEvent): Promise<void> => {
    const id = asString(event.run_id);
    const call = open.get(id);
    const phase = call === undefined ? undefined : PHASE_LABEL[call.tool];
    if (call === undefined || phase === undefined) return;
    open.delete(id);

    const output = unwrap(event.data?.output);
    const artifact = asRecord(output.artifact);
    // A step that hands its failure back as data never throws, so the message
    // around it still reads as a success. The artifact is where it says so.
    if (output.status === "error" || artifact.status === "error") {
      updateEntry(id, {
        kind: "error",
        running: false,
        // A failed step never earned its past tense; the live verb stays true.
        label: runLine(phase.live, call.name),
        detail:
          firstLine(asString(artifact.message)) ??
          firstLine(textOf(output.content)),
      });
      return;
    }

    const fileId = fileIdOf(artifact) ?? asFileId(call.target);
    if (fileId !== undefined && call.name !== undefined) {
      run.names.set(fileId, call.name);
    }

    if (artifact.reason === "input-required") {
      if (call.target !== undefined) {
        locked.set(call.target, {
          pathOrId: call.target,
          relPath: call.name ?? call.target,
          message: asString(artifact.message),
        });
      }
      updateEntry(id, {
        kind: "note",
        running: false,
        label: runLine("Locked", call.name),
        detail: "waiting for its password",
      });
      return;
    }

    const refusal = refusalOf(artifact);
    if (refusal !== undefined) {
      // A partial commit still posted the rows it names; the tally keeps them.
      if (artifact.reason === "partial") {
        TALLY_OF.ingestCommit?.(run, artifact, fileId);
      }
      updateEntry(id, {
        kind: "note",
        running: false,
        label: runLine(refusal.label, call.name),
        detail: refusal.detail,
        fileId,
      });
      if (artifact.reason === "mismatch" && fileId !== undefined) {
        await superviseClose(run, fileId, call.name);
      }
      return;
    }

    if (call.tool === "ingestPrepare" && call.target !== undefined) {
      locked.delete(call.target);
      // A file the run was handed registers part-way through under an id the
      // run could not have held at the start; that id is this run's too.
      if (fileId !== undefined && run.own.has(call.target)) {
        run.own.add(fileId);
      }
    }
    if (call.tool === "ingestDone" && fileId !== undefined) {
      run.refusedCloses.delete(fileId);
    }
    TALLY_OF[call.tool]?.(run, artifact, fileId);
    updateEntry(id, {
      kind: "tool",
      running: false,
      label: runLine(phase.done, call.name),
      detail: detailOf(artifact),
      fileId,
    });
  };

  const handlers: Record<
    string,
    (event: LangGraphEvent) => void | Promise<void>
  > = {
    on_chat_model_start: () => {
      turnText = "";
    },
    on_chat_model_stream: (event) => {
      turnText += textOf(unwrap(event.data?.chunk).content);
    },
    on_chat_model_end: () => {
      const text = turnText.trim();
      turnText = "";
      if (text.length > 0) said.push(text);
    },
    on_tool_start: startCall,
    on_tool_end: endCall,
  };

  try {
    for await (const event of agent.events(run.transcript, signal)) {
      if (nsDepth(event) > 0) continue;
      await handlers[event.event]?.(event);
    }
  } catch (cause) {
    // A step whose end never arrived would otherwise pulse in the feed forever.
    for (const [id, call] of open) {
      updateEntry(id, {
        kind: "error",
        running: false,
        label: runLine(PHASE_LABEL[call.tool]?.live, call.name),
        detail: "stopped before it finished",
      });
    }
    settleFailure(run, cause);
    return;
  }

  // The graph keeps nothing between turns, so the transcript is the whole memory.
  if (said.length > 0) {
    run.transcript = [
      ...run.transcript,
      message("assistant", said.join("\n\n")),
    ];
  }

  const locks = [...locked.values()];
  if (locks.length > 0) {
    // Nothing may fall through: this either parks the run or starts a turn, and
    // settling under a live turn would end the run the unlock just continued.
    await unlockOrPark(run, locks);
    return;
  }

  if (run.mode === "normal") await noteClarifications();

  settle(run, "done");
  note("Run finished", tallySaid(run.tally));
  appendEntry({
    id: crypto.randomUUID(),
    kind: "summary",
    label: said.at(-1) ?? "Run finished.",
  });
};

/** Detached on purpose: the request that asked for the work does not wait for it. */
const advance = (run: Run, text: string): void => {
  run.transcript = [...run.transcript, message("user", text)];
  void runTurn(run).catch((cause: unknown) => {
    settleFailure(run, cause);
  });
};

const labelOf = (scope: RunScope): string =>
  "pathOrId" in scope
    ? scope.pathOrId
    : `${String(scope.pathOrIds.length)} selected`;

/** Which way this run was asked to handle what the ledger asks back. */
const MODE_NOTE: Record<RunMode, string> = {
  auto: "auto — the agent answers the questions itself",
  normal: "normal — ambiguous questions wait for you",
};

export const startRun = async (
  scope: RunScope,
  mode: RunMode,
): Promise<StartResult> => {
  if (!isAiEnabled()) {
    return err({
      reason: "disabled",
      message:
        "Set OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_API_KEY to let the agent work the queue.",
    });
  }

  const previous = slot.run;
  if (previous !== null && isRunLive(previous.status)) {
    return err({
      reason: "busy",
      message: "A run is already working the queue.",
    });
  }

  const run: Run = {
    runId: crypto.randomUUID(),
    scope: labelOf(scope),
    mode,
    startedAt: Date.now(),
    abort: new AbortController(),
    names: new Map(),
    own: new Set(),
    refusedCloses: new Map(),
    unlockAttempts: new Map(),
    tally: { closed: new Set(), discarded: new Set(), rows: 0 },
    status: "running",
    files: 0,
    transcript: [],
  };
  // Claimed before the first await: two starts landing together must not both pass.
  slot.run = run;

  const rows = await caller.ledger.ingest.list().then(
    (page) => page.rows,
    () => null,
  );
  if (rows === null) {
    slot.run = previous;
    return err({
      reason: "unavailable",
      message: "The ingest queue could not be read.",
    });
  }

  for (const row of rows) {
    if (row.file_id !== null) run.names.set(row.file_id, row.rel_path);
  }

  let targets: RunTarget[];
  try {
    targets = await selectTargets(scope, rows);
  } catch (cause) {
    slot.run = previous;
    return err({
      reason: "unavailable",
      message:
        cause instanceof Error ? cause.message : "The ledger did not answer.",
    });
  }
  run.files = targets.length;
  for (const target of targets) {
    run.own.add(target.relPath);
    if (target.fileId !== null) run.own.add(target.fileId);
  }

  note(
    `Run started — ${String(targets.length)} ${targets.length === 1 ? "file" : "files"}`,
    MODE_NOTE[mode],
  );
  advance(run, objectiveOf(targets, mode));
  return ok({ runId: run.runId });
};

const wasCancelled = (run: Run): boolean => run.abort.signal.aborted;

const parked = (): { run: Run; waiting: Waiting } | null => {
  const run = slot.run;
  if (run === null) return null;
  if (run.status !== "waiting-password") return null;
  if (run.waiting === undefined) return null;
  return { run, waiting: run.waiting };
};

const NOT_PARKED = "No run is waiting for a password.";

/**
 * The runner unlocks the file itself, and then every other locked file this run
 * was handed, so one bank's year of statements costs one prompt. The password
 * reaches `oled` as one argv the connector masks, and never reaches the model,
 * the journal or a log.
 */
export const submitPassword = async (
  password: string,
): Promise<RunCommandResult> => {
  const found = parked();
  if (found === null) return err({ message: NOT_PARKED });
  const { run, waiting } = found;

  run.status = "running";
  run.waiting = undefined;
  run.password = password;

  const unlocked = await tryUnlock(run, waiting);
  // Every prepare here spends minutes with no turn in flight: a cancel lands
  // between them or nowhere, so each gap checks before parking or advancing.
  // Through a call, not the property: narrowing survives an await, a cancel
  // does not wait for one.
  if (wasCancelled(run)) {
    settleCancelled(run);
    return ok(undefined);
  }
  if (!unlocked.ok) {
    park(run, { ...waiting, message: unlocked.error.message });
    return ok(undefined);
  }

  const named = await unlockRest(run, unlocked.value);
  if (wasCancelled(run)) {
    settleCancelled(run);
    return ok(undefined);
  }
  advance(run, continuationFor(named));
  return ok(undefined);
};

/**
 * Skips one file, not the run: earlier unlocks may have paid for prepares no
 * turn has read yet, and ending here would strand that work. The run goes on
 * with whatever is already readable and settles only when nothing is.
 */
export const skipWaiting = async (): Promise<RunCommandResult> => {
  const found = parked();
  if (found === null) return err({ message: NOT_PARKED });
  const { run, waiting } = found;

  note(runLine("Skipped", waiting.relPath), "left locked");
  run.status = "running";
  run.waiting = undefined;

  const scan = await scanLocked(run);
  if (run.abort.signal.aborted) {
    settleCancelled(run);
    return ok(undefined);
  }
  if (scan.prepared.length === 0) {
    settle(run, "done");
    return ok(undefined);
  }
  advance(run, continuationFor(scan.prepared));
  return ok(undefined);
};

export const cancelRun = (): RunCommandResult => {
  const run = slot.run;
  if (run === null || !isRunLive(run.status)) {
    return err({ message: "No run is working the queue." });
  }
  // A parked run has no turn in flight to interrupt; it ends here instead.
  if (run.status === "waiting-password") {
    settleCancelled(run);
    return ok(undefined);
  }
  run.abort.abort();
  return ok(undefined);
};

/** Field by field, so neither the transcript nor the controller can leak out. */
export const readRun = (): RunSnapshot | null => {
  const run = slot.run;
  if (run === null) return null;
  return {
    runId: run.runId,
    status: run.status,
    scope: run.scope,
    mode: run.mode,
    currentFile: run.currentFile,
    waiting:
      run.waiting === undefined
        ? undefined
        : { relPath: run.waiting.relPath, message: run.waiting.message },
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
};
