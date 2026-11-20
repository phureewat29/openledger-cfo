import type { UIMessage } from "ai";
import { TRPCError } from "@trpc/server";
import { attemptAsync, partition, uniqBy } from "es-toolkit";

import type { LangGraphEvent } from "@openledger-cfo/agent";
import type { GatewayConfig, RouterOutputs } from "@openledger-cfo/api";
import type { Result } from "@openledger-cfo/openledger";
import { createAgent, nsDepth, unwrap } from "@openledger-cfo/agent";
import { asRecord, asString, textOf } from "@openledger-cfo/agent/untyped";
import { caller, readGateway } from "@openledger-cfo/api";
import { perProcess } from "@openledger-cfo/db";
import { err, messageOf, ok } from "@openledger-cfo/openledger";
import { parseJson } from "@openledger-cfo/openledger/result";

import type { IngestFile } from "~/ingest/files";
import type {
  RunMode,
  RunSnapshot,
  RunStatus,
  RunTarget,
  RunWaiting,
} from "~/ingest/run";
import { openQuestionsByFile, pathKeyOf, WORKABLE } from "~/ingest/files";
import { appendEntry, updateEntry } from "~/ingest/journal";
import { isRunLive, objectiveOf, PHASE_LABEL, runLine } from "~/ingest/run";
import { countNoun } from "~/lib/format";

export type StartFailure = "disabled" | "busy" | "unavailable";

type StartResult = Result<
  { runId: string },
  { reason: StartFailure; message: string }
>;

type RunCommandResult = Result<undefined, { message: string }>;

/** The two names a locked file answers to, and neither of them is its password. */
interface Lockable {
  /** What ingestPrepare is retried with — a path or an id, never the password. */
  readonly pathOrId: string;
  readonly relPath: string;
}

interface Waiting extends RunWaiting, Lockable {}

type SettledStatus = Exclude<RunStatus, "running" | "waiting-password">;

/**
 * Only a parked run names the file it waits on; a settled run holds no password.
 * The password reaches `oled` as one masked argv, never the transcript, the journal or a snapshot.
 */
type Phase =
  | {
      readonly status: "running";
      readonly currentFile?: string;
      readonly password?: string;
    }
  | {
      readonly status: "waiting-password";
      readonly waiting: Waiting;
      readonly password?: string;
    }
  | { readonly status: SettledStatus; readonly finishedAt: number };

/** Sets, not counters: a supervised close and the model's idempotent retry are one closed file. */
interface Tally {
  readonly closed: ReadonlySet<string>;
  readonly discarded: ReadonlySet<string>;
  readonly rows: number;
}

/** Phase, tally and transcript are replaced whole; the maps and sets change in place. */
interface Run {
  readonly runId: string;
  readonly scope: string;
  readonly mode: RunMode;
  /** Captured at start: a live run keeps the credentials it began with. */
  readonly gateway: GatewayConfig;
  readonly startedAt: number;
  readonly abort: AbortController;
  /** File id → the name the operator dropped, so later lines can say it back. */
  readonly names: Map<string, string>;
  /** The paths this run was handed and the ids its prepares gave them: the agent wanders, so only these count. */
  readonly own: Set<string>;
  /** Consecutive closes the ledger turned down, per file. */
  readonly refusedCloses: Map<string, number>;
  /** Prepares this run has spent trying its password on a file, per file. */
  readonly unlockAttempts: Map<string, number>;
  files: number;
  phase: Phase;
  tally: Tally;
  transcript: UIMessage[];
}

/** One slot per process: a second start is refused rather than queued. */
const slot = perProcess<{ run: Run | null }>("ingestRun", () => ({
  run: null,
}));

/** Graph supersteps, not model turns: one statement costs a dozen round trips. */
const recursionLimitFor = (files: number): number =>
  Math.min(64 + 40 * (files - 1), 320);

const FILE_BUDGET_MS = 15 * 60_000;
const BUDGETED_FILES = 6;

/** Wall clock, so a stalled gateway cannot hold the slot until a restart. */
const budgetFor = (files: number): number =>
  Math.min(files, BUDGETED_FILES) * FILE_BUDGET_MS;

/** The graph hands a tool's arguments over as a JSON string nested in `input`. */
const inputOf = (event: LangGraphEvent): Record<string, unknown> => {
  const wrapper = asRecord(event.data?.input);
  const raw = wrapper.input;
  if (typeof raw !== "string") return wrapper;
  return asRecord(parseJson(raw));
};

/** Which statement a step is about: the only input fields this file reads. */
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

/** What was read and what was posted: the only result fields a line quotes. */
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

/** The refusals a close or a commit hands back as data instead of throwing. */
type IngestRefusal = Extract<
  RouterOutputs["ledger"]["ingest"]["commit" | "done"],
  { ok: false }
>["reason"];

interface Refusal {
  readonly label: string;
  readonly detail: string;
  readonly after: (
    run: Run,
    artifact: Record<string, unknown>,
    fileId: string | undefined,
    name: string | undefined,
  ) => Promise<void> | void;
}

/** A refused step still answers with an artifact, but never earned its finished tense. */
const REFUSAL: Readonly<Record<string, Refusal>> = {
  mismatch: {
    label: "Close refused",
    detail: "the closing balance did not match the ledger",
    after: (run, _artifact, fileId, name) =>
      fileId === undefined ? undefined : superviseClose(run, fileId, name),
  },
  // A partial commit still posted the rows it names; the tally keeps them.
  partial: {
    label: "Rows refused",
    detail: "some rows did not post",
    after: (run, artifact, fileId) => {
      tallyStep(run, "ingestCommit", artifact, fileId);
    },
  },
} satisfies Record<IngestRefusal, Refusal>;

const refusalOf = (artifact: Record<string, unknown>): Refusal | undefined =>
  typeof artifact.reason === "string" ? REFUSAL[artifact.reason] : undefined;

const withId = (ids: ReadonlySet<string>, id: string): ReadonlySet<string> =>
  new Set([...ids, id]);

/** What each landed step adds to the tally; a tool absent here changes nothing. */
const TALLY_OF: Record<
  string,
  (tally: Tally, artifact: Record<string, unknown>, fileId: string) => Tally
> = {
  ingestDone: (tally, _artifact, fileId) => ({
    ...tally,
    closed: withId(tally.closed, fileId),
  }),
  ingestFail: (tally, _artifact, fileId) => ({
    ...tally,
    discarded: withId(tally.discarded, fileId),
  }),
  ingestCommit: (tally, artifact) => {
    const posted = asRecord(artifact.summary).posted;
    return typeof posted === "number"
      ? { ...tally, rows: tally.rows + posted }
      : tally;
  },
};

/** Only files the run was asked for count — the agent does wander. */
const tallyStep = (
  run: Run,
  tool: string,
  artifact: Record<string, unknown>,
  fileId: string | undefined,
): void => {
  const step = TALLY_OF[tool];
  if (step === undefined || fileId === undefined || !run.own.has(fileId)) {
    return;
  }
  run.tally = step(run.tally, artifact, fileId);
};

const tallySaid = (tally: Tally): string => {
  const said = runLine(
    tally.closed.size > 0 ? `closed ${String(tally.closed.size)}` : undefined,
    tally.discarded.size > 0
      ? `discarded ${String(tally.discarded.size)}`
      : undefined,
    tally.rows > 0 ? `posted ${countNoun(tally.rows, "row")}` : undefined,
  );
  return said.length === 0 ? "nothing changed" : said;
};

/** A model that will not close on file id alone loops until its steps run out; twice proves it. */
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
 * A locked prepare registers a file id too, and closing deletes the text. This
 * reads the artifact instead of spawning a command, so it is affordable per file.
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

/** A name the queue snapshot no longer holds is still work: the agent finds it where it lies. */
const targetOfName = async (
  name: string,
  rows: IngestFile[],
): Promise<RunTarget> => {
  const keyOf = (path: string) => pathKeyOf(path, process.platform);
  const key = keyOf(name);
  const row = rows.find(
    (candidate) =>
      keyOf(candidate.rel_path) === key ||
      keyOf(candidate.path) === key ||
      candidate.file_id === name,
  );
  if (row !== undefined) return targetOfRow(row);
  return { relPath: name, status: "new", fileId: null, prepared: false };
};

/** The ingest queue's rows, or undefined when the ledger did not answer. */
const listQueue = (): Promise<IngestFile[] | undefined> =>
  caller.ledger.ingest.list().then(
    (page) => page.rows,
    () => undefined,
  );

/** Named files are worked whatever state they are in; a locked one parks the run. */
const selectTargets = (
  pathOrIds: readonly string[],
  rows: IngestFile[],
): Promise<RunTarget[]> =>
  Promise.all(pathOrIds.map((name) => targetOfName(name, rows)));

/** A Normal run's posted-but-open files, said in the feed: their questions are the operator's. */
const noteClarifications = async (): Promise<void> => {
  const [files, questions] = await Promise.all([
    listQueue(),
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

const passwordOf = (phase: Phase): string | undefined =>
  "password" in phase ? phase.password : undefined;

/** Parking keeps the password in hand: the next lock may open with it. */
const parkedOn = (phase: Phase, waiting: Waiting): Phase => ({
  status: "waiting-password",
  waiting,
  password: passwordOf(phase),
});

/** Back to work on the file it parked on. */
const resumedFrom = (
  waiting: Waiting,
  password: string | undefined,
): Phase => ({
  status: "running",
  currentFile: waiting.relPath,
  password,
});

const workingOn = (phase: Phase, currentFile: string): Phase =>
  phase.status === "running" ? { ...phase, currentFile } : phase;

/** A finished run lingers in the slot until the next start; its password does not. */
const settle = (run: Run, status: SettledStatus): void => {
  run.phase = { status, finishedAt: Date.now() };
};

/** A call, not the property: after an await, a narrowed property would still read false. */
const wasCancelled = (run: Run): boolean => run.abort.signal.aborted;

const park = (run: Run, waiting: Waiting): void => {
  run.phase = parkedOn(run.phase, waiting);
  appendEntry({
    id: crypto.randomUUID(),
    kind: "ask",
    label: runLine(waiting.relPath, "needs its password"),
    detail: waiting.message,
  });
};

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

/** What the feed says of a turn that ended badly, ahead of the tally. */
const failureOf = (
  run: Run,
  cause: unknown,
): { readonly label: string; readonly detail?: string } => {
  if (cause instanceof Error && cause.name === "GraphRecursionError") {
    return {
      label:
        "Run stopped — it reached its step limit. Select what is still open and press Ingest again.",
    };
  }
  if (isTimeout(cause)) {
    return {
      label: `Run stopped — it passed its ${String(budgetFor(run.files) / 60_000)} minute limit. Select what is still open and press Ingest again.`,
    };
  }
  return { label: "Run failed.", detail: messageOf(cause) };
};

/** Said with the tally: a stopped run is when the operator most needs to know what landed. */
const settleFailure = (run: Run, cause: unknown): void => {
  if (wasCancelled(run)) {
    settleCancelled(run);
    return;
  }
  const failure = failureOf(run, cause);
  settle(run, "failed");
  note(failure.label, runLine(failure.detail, tallySaid(run.tally)));
};

interface Unlocked {
  readonly relPath: string;
  readonly fileId: string;
}

/**
 * Every failure comes back as a value: a throw would reach `submitPassword`'s
 * route as a 500 and leave the run `running` with no turn in flight.
 */
const tryUnlock = async (
  run: Run,
  { pathOrId, relPath }: Lockable,
): Promise<Result<Unlocked, { message: string }>> => {
  const prepared = await caller.ledger.ingest
    .prepare({ pathOrId, password: passwordOf(run.phase) })
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

/** A rel_path in one turn and its sf- id in the next are one file to the attempt count. */
const attemptKeyOf = (run: Run, pathOrId: string): string =>
  run.names.get(pathOrId) ?? pathOrId;

/** Counts one more against `key` and says the new count. */
const bump = (counts: Map<string, number>, key: string): number => {
  const count = (counts.get(key) ?? 0) + 1;
  counts.set(key, count);
  return count;
};

/** One file at a time: with no turn in flight, the gap between prepares is where a cancel lands. */
const unlockEach = async (
  run: Run,
  files: readonly Lockable[],
): Promise<Sweep> => {
  const unlocked: Unlocked[] = [];
  const locked: Waiting[] = [];
  for (const file of files) {
    if (wasCancelled(run)) break;
    run.phase = workingOn(run.phase, file.relPath);
    bump(run.unlockAttempts, attemptKeyOf(run, file.pathOrId));
    const out = await tryUnlock(run, file);
    if (out.ok) unlocked.push(out.value);
    else locked.push({ ...file, message: out.error.message });
  }
  return { unlocked, locked };
};

/** Per file per run: each unlock hands the model a fresh turn, so re-preparing could loop forever. */
const UNLOCK_ATTEMPT_LIMIT = 2;

/** No `own` gate: a locked file the model wandered into is still the operator's to unlock. */
const autoUnlock = async (
  run: Run,
  files: readonly Waiting[],
): Promise<Sweep> => {
  if (passwordOf(run.phase) === undefined) {
    return { unlocked: [], locked: [...files] };
  }

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
  const rows = await listQueue();
  const mine = (rows ?? []).filter(
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

/** A bank issues a year of statements under one password, so the operator types it once. */
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
 * Named by prepared id, or the model re-prepares and a locked file asks for its
 * password again. Deduped: `oled` collapses identical bytes into one id.
 */
const continuationFor = (unlocked: readonly Unlocked[]): string => {
  const files = uniqBy([...unlocked], (file) => file.fileId);
  const named = files
    .map((file) => `- ${file.relPath} is prepared as ${file.fileId}`)
    .join("\n");
  return `The operator's password unlocked ${countNoun(files.length, "file")}; every one of them is prepared already, so do not prepare any of them again:\n${named}\n\nRead each one, post its rows and close it, then finish the rest of the queue.`;
};

/** The password opens what it can, the model gets the rest back, and the operator types for what stays locked. */
const unlockOrPark = async (
  run: Run,
  locked: readonly Waiting[],
): Promise<void> => {
  const swept = await autoUnlock(run, locked);
  if (wasCancelled(run)) {
    settleCancelled(run);
    return;
  }

  // Unlocked files reach the model now: a park can end in Skip or Cancel and
  // strand them. Still-locked files re-surface next turn, up to the cap.
  if (swept.unlocked.length > 0) {
    advance(run, continuationFor(swept.unlocked));
    return;
  }
  const first = swept.locked[0];
  if (first !== undefined) park(run, first);
};

/** Exactly at the limit, never past it: later refusals argue with a file already closed. */
const superviseClose = async (
  run: Run,
  fileId: string,
  name: string | undefined,
): Promise<void> => {
  if (bump(run.refusedCloses, fileId) !== REFUSED_CLOSE_LIMIT) return;

  const [cause, out] = await attemptAsync(() =>
    caller.ledger.ingest.done({ fileId }),
  );
  if (cause !== null) {
    note(
      runLine("Close failed", name),
      cause instanceof Error ? firstLine(cause.message) : undefined,
    );
    return;
  }
  // A refusal here means the model's next fileId-only retry can still land.
  if (out?.ok !== true) return;
  tallyStep(run, "ingestDone", {}, fileId);
  note(runLine("Closed", name), RECONCILE_SKIPPED);
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
    gateway: run.gateway,
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
    if (name !== undefined) run.phase = workingOn(run.phase, name);
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
      updateEntry(id, {
        kind: "note",
        running: false,
        label: runLine(refusal.label, call.name),
        detail: refusal.detail,
        fileId,
      });
      await refusal.after(run, artifact, fileId, call.name);
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
    tallyStep(run, call.tool, artifact, fileId);
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

/** The queue as it stands, and the targets the run names in it. */
const readQueue = async (
  pathOrIds: readonly string[],
): Promise<Result<{ rows: IngestFile[]; targets: RunTarget[] }, string>> => {
  const rows = await listQueue();
  if (rows === undefined) return err("The ingest queue could not be read.");
  return selectTargets(pathOrIds, rows).then(
    (targets) => ok({ rows, targets }),
    (cause: unknown) =>
      err(
        cause instanceof Error ? cause.message : "The ledger did not answer.",
      ),
  );
};

/** Which way this run was asked to handle what the ledger asks back. */
const MODE_NOTE: Record<RunMode, string> = {
  auto: "auto — the agent answers the questions itself",
  normal: "normal — ambiguous questions wait for you",
};

/** A run is always asked for by name; there is no whole-queue run. */
export const startRun = async (
  pathOrIds: readonly string[],
  mode: RunMode,
): Promise<StartResult> => {
  // Read before the busy check: the check-and-claim below must stay awaitless.
  const gateway = await readGateway();
  if (gateway === undefined) {
    return err({
      reason: "disabled",
      message:
        "Configure the AI gateway in the app settings to let the agent work the queue.",
    });
  }

  const previous = slot.run;
  if (previous !== null && isRunLive(previous.phase.status)) {
    return err({
      reason: "busy",
      message: "A run is already working the queue.",
    });
  }

  const run: Run = {
    runId: crypto.randomUUID(),
    scope: `${String(pathOrIds.length)} selected`,
    mode,
    gateway,
    startedAt: Date.now(),
    abort: new AbortController(),
    names: new Map(),
    own: new Set(),
    refusedCloses: new Map(),
    unlockAttempts: new Map(),
    files: 0,
    phase: { status: "running" },
    tally: { closed: new Set(), discarded: new Set(), rows: 0 },
    transcript: [],
  };
  // Claimed before the first await: two starts landing together must not both pass.
  slot.run = run;

  const queue = await readQueue(pathOrIds);
  if (!queue.ok) {
    slot.run = previous;
    return err({ reason: "unavailable", message: queue.error });
  }

  const { rows, targets } = queue.value;
  for (const row of rows) {
    if (row.file_id !== null) run.names.set(row.file_id, row.rel_path);
  }
  run.files = targets.length;
  for (const target of targets) {
    run.own.add(target.relPath);
    if (target.fileId !== null) run.own.add(target.fileId);
  }

  note(`Run started — ${countNoun(targets.length, "file")}`, MODE_NOTE[mode]);
  advance(run, objectiveOf(targets, mode));
  return ok({ runId: run.runId });
};

const parked = (): { run: Run; waiting: Waiting } | null => {
  const run = slot.run;
  if (run === null) return null;
  const { phase } = run;
  if (phase.status !== "waiting-password") return null;
  return { run, waiting: phase.waiting };
};

const NOT_PARKED = "No run is waiting for a password.";

/** The runner unlocks the file itself, then every other locked file this run was handed. */
export const submitPassword = async (
  password: string,
): Promise<RunCommandResult> => {
  const found = parked();
  if (found === null) return err({ message: NOT_PARKED });
  const { run, waiting } = found;

  run.phase = resumedFrom(waiting, password);

  const unlocked = await tryUnlock(run, waiting);
  // No turn is in flight, so a cancel lands between prepares or nowhere.
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

/** One file, not the run: earlier unlocks may have paid for prepares no turn has read yet. */
export const skipWaiting = async (): Promise<RunCommandResult> => {
  const found = parked();
  if (found === null) return err({ message: NOT_PARKED });
  const { run, waiting } = found;

  note(runLine("Skipped", waiting.relPath), "left locked");
  run.phase = resumedFrom(waiting, passwordOf(run.phase));

  const scan = await scanLocked(run);
  if (wasCancelled(run)) {
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
  if (run === null || !isRunLive(run.phase.status)) {
    return err({ message: "No run is working the queue." });
  }
  // A parked run has no turn in flight to interrupt; it ends here instead.
  if (run.phase.status === "waiting-password") {
    settleCancelled(run);
    return ok(undefined);
  }
  run.abort.abort();
  return ok(undefined);
};

type PhaseView = Pick<
  RunSnapshot,
  "status" | "currentFile" | "waiting" | "finishedAt"
>;

/** A parked run is on the file it waits for, and says only its name and why. */
const phaseView = (phase: Phase): PhaseView => {
  if (phase.status === "running") {
    return { status: phase.status, currentFile: phase.currentFile };
  }
  if (phase.status === "waiting-password") {
    const { relPath, message } = phase.waiting;
    return {
      status: phase.status,
      currentFile: relPath,
      waiting: { relPath, message },
    };
  }
  return { status: phase.status, finishedAt: phase.finishedAt };
};

/** Field by field, so the transcript, the password and the controller stay inside. */
export const readRun = (): RunSnapshot | null => {
  const run = slot.run;
  if (run === null) return null;
  const view = phaseView(run.phase);
  return {
    runId: run.runId,
    status: view.status,
    scope: run.scope,
    mode: run.mode,
    currentFile: view.currentFile,
    waiting: view.waiting,
    startedAt: run.startedAt,
    finishedAt: view.finishedAt,
  };
};
