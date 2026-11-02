import { execFile } from "node:child_process";
import { EXIT } from "@aquartier/openledger/contract";
import { attempt, delay, isPlainObject } from "es-toolkit";

import type { OledError } from "./errors";
import type { Result } from "./result";
import { EXIT_KIND, parseCliErrorLine } from "./errors";
import { err, ok } from "./result";
import { createSerialQueue } from "./serial";

// Spawning a CLI is impossible in a browser bundle; fail at import rather than at first call.
if ("window" in globalThis) {
  throw new Error(
    "@openledger-cfo/openledger is server-only: it spawns the `oled` CLI.",
  );
}

const OLED_BIN = "oled";

// Statement batches and full-ledger reads comfortably exceed the 1MB default.
const MAX_BUFFER = 64 * 1024 * 1024;

export type OledLane = "fast" | "slow";

/**
 * Process-wide on purpose: every connector reaches the same ledger file, so
 * all of them share the lanes that serialize it, and one id sequence keeps a
 * listener shared between connectors from pairing one command's start with
 * another's end.
 *
 * Two lanes, not one: `ingest prepare` can hold a statement for minutes under
 * OCR, and a single queue would block every read behind it — overlaps can
 * still contend for the ledger lock (exit 8, retried below).
 */
const createLanes = () => {
  const lanes = { fast: createSerialQueue(), slow: createSerialQueue() };
  let lastId = 0;
  return <T>(lane: OledLane, task: (id: number) => Promise<T>): Promise<T> =>
    lanes[lane](() => task(++lastId));
};

const inLane = createLanes();

/** Flags whose following argument must never reach a log, a UI, or an error. */
const SECRET_FLAGS = new Set(["--password", "--ocr-api-key"]);

/** What stands in for a secret in a log, a UI, or an error. */
export const SECRET_MASK = "•••";

const maskArgv = (argv: string[]): string[] =>
  argv.map((arg, index) =>
    SECRET_FLAGS.has(argv[index - 1] ?? "") ? SECRET_MASK : arg,
  );

export interface OledCommandEvent {
  phase: "start" | "end";
  id: number;
  ts: number;
  /** The full final argv, already masked. */
  argv: string[];
  /** -1 when the binary could not be spawned at all. */
  exitCode?: number;
  durationMs?: number;
}

export type OledCommandListener = (event: OledCommandEvent) => void;

const toFinalArgv = (args: string[], configPath: string): string[] => [
  ...args,
  "--json",
  "--no-color",
  "--config",
  configPath,
];

/**
 * Walks a flag table over an input, in table order: `undefined` and `false`
 * are absent, `true` is a bare switch, and an object travels as JSON.
 */
export const toFlagArgs = <TInput extends object>(
  flags: Partial<Record<keyof TInput & string, string>>,
  input: TInput,
): string[] =>
  (Object.entries(flags) as [keyof TInput & string, string][]).flatMap(
    ([key, flag]) => {
      const value = input[key];
      if (value === undefined || value === false) return [];
      if (value === true) return [flag];
      return [
        flag,
        isPlainObject(value) ? JSON.stringify(value) : String(value),
      ];
    },
  );

// Everything outside this set would change meaning when the command is pasted back into a shell.
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

export const quoteShellArg = (arg: string): string =>
  SHELL_SAFE.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

/**
 * The command as a shell could run it, secrets masked. Quoting runs first:
 * masking replaces a whole rendered argument, and no secret flag needs quotes.
 */
export const formatOledCommand = (args: string[], configPath: string): string =>
  [
    OLED_BIN,
    ...maskArgv(toFinalArgv(args, configPath).map(quoteShellArg)),
  ].join(" ");

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  spawnError?: string;
}

const spawnOled = (argv: string[], stdin?: string): Promise<SpawnOutcome> =>
  new Promise<SpawnOutcome>((resolve) => {
    const child = execFile(
      OLED_BIN,
      argv,
      { maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        // execFile reports spawn failures as a string errno and exits as a number.
        const code: unknown = error.code;
        if (typeof code === "string") {
          resolve({ stdout, stderr, exitCode: -1, spawnError: code });
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode: typeof code === "number" ? code : 1,
        });
      },
    );

    if (stdin === undefined) return;
    // A command that rejects its config exits before draining stdin; EPIPE is not our failure.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin);
  });

// E_BUSY: another process held the ledger past the CLI's own ~5s wait; the
// command emitted nothing, so re-running is safe — writes included.
const BUSY_RETRY_DELAYS_MS = [25, 75, 150];

const spawnRetryingBusy = async (
  argv: string[],
  stdin: string | undefined,
  delays = BUSY_RETRY_DELAYS_MS,
): Promise<SpawnOutcome> => {
  const outcome = await spawnOled(argv, stdin);
  const [wait, ...rest] = delays;
  if (outcome.exitCode !== EXIT.BUSY || wait === undefined) return outcome;
  await delay(wait);
  return spawnRetryingBusy(argv, stdin, rest);
};

const toSpawnError = (code: string): OledError => {
  if (code === "ENOENT") {
    return {
      kind: "spawn_failed",
      message: `\`${OLED_BIN}\` was not found on PATH.`,
      hint: "Install the OpenLedger data plane: `npm install -g @aquartier/openledger`.",
    };
  }
  return {
    kind: "spawn_failed",
    message: `Failed to spawn \`${OLED_BIN}\`: ${code}`,
  };
};

const toExitError = (outcome: SpawnOutcome, argv: string[]): OledError => {
  const cliError = parseCliErrorLine(outcome.stderr);
  const bare =
    outcome.stderr.trim() ||
    `\`${OLED_BIN} ${argv[0] ?? ""}\` exited ${String(outcome.exitCode)}`;
  return {
    kind: EXIT_KIND[outcome.exitCode] ?? "cli_error",
    message: cliError?.message ?? bare,
    ...(cliError?.hint === undefined ? {} : { hint: cliError.hint }),
    exitCode: outcome.exitCode,
  };
};

interface RunOutcome {
  result: Result<string, OledError>;
  exitCode: number;
}

const run = async (
  argv: string[],
  stdin: string | undefined,
  allowPartial: boolean,
): Promise<RunOutcome> => {
  const outcome = await spawnRetryingBusy(argv, stdin).catch(
    (): SpawnOutcome => ({
      stdout: "",
      stderr: "",
      exitCode: -1,
      spawnError: "ESPAWN",
    }),
  );

  if (outcome.spawnError !== undefined) {
    return { result: err(toSpawnError(outcome.spawnError)), exitCode: -1 };
  }
  // Exit 7 wrote its results to stdout; the caller decides what a partial run means.
  if (
    outcome.exitCode === 0 ||
    (outcome.exitCode === EXIT.PARTIAL && allowPartial)
  ) {
    return { result: ok(outcome.stdout), exitCode: outcome.exitCode };
  }

  return {
    result: err(toExitError(outcome, argv)),
    exitCode: outcome.exitCode,
  };
};

// The listener is caller code on the command path: its failure is not the command's.
const notify = (
  listener: OledCommandListener | undefined,
  event: OledCommandEvent,
): void => {
  if (listener) attempt(() => listener(event));
};

interface RunObservedOptions {
  stdin?: string;
  allowPartial: boolean;
  lane: OledLane;
  onCommand?: OledCommandListener;
}

/** Both events fire inside the lane, so `start` is execution, never queue wait. */
const runObserved = (
  argv: string[],
  opts: RunObservedOptions,
): Promise<Result<string, OledError>> =>
  inLane(opts.lane, async (id) => {
    const masked = maskArgv(argv);
    const startedAt = Date.now();
    notify(opts.onCommand, { phase: "start", id, ts: startedAt, argv: masked });

    const outcome = await run(argv, opts.stdin, opts.allowPartial);

    const ts = Date.now();
    notify(opts.onCommand, {
      phase: "end",
      id,
      ts,
      argv: masked,
      exitCode: outcome.exitCode,
      durationMs: ts - startedAt,
    });
    return outcome.result;
  });

interface RunOledOptions {
  configPath: string;
  stdin?: string;
  /** Return stdout instead of an error when the command exits 7 (partial). */
  allowPartial?: boolean;
  lane?: OledLane;
  onCommand?: OledCommandListener;
}

export const runOled = (
  args: string[],
  opts: RunOledOptions,
): Promise<Result<string, OledError>> =>
  runObserved(toFinalArgv(args, opts.configPath), {
    stdin: opts.stdin,
    allowPartial: opts.allowPartial ?? false,
    lane: opts.lane ?? "fast",
    onCommand: opts.onCommand,
  });

/**
 * `oled config` takes its config file as a positional argument and rejects
 * `--config`, so it cannot go through runOled.
 */
export const runOledConfig = (
  args: string[],
  opts: { stdin?: string; onCommand?: OledCommandListener } = {},
): Promise<Result<string, OledError>> =>
  runObserved([...args, "--json", "--no-color"], {
    stdin: opts.stdin,
    allowPartial: false,
    lane: "fast",
    onCommand: opts.onCommand,
  });
