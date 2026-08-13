import { execFile } from "node:child_process";
import { delay } from "es-toolkit";

import type { OledError, OledErrorKind } from "./errors";
import type { Result } from "./result";
import { EXIT_KIND, parseCliErrorLine } from "./errors";
import { err, ok } from "./result";
import { createSerialQueue } from "./serial";

// Spawning a CLI is impossible in a browser bundle; fail at import rather than at first call.
if ("window" in globalThis) {
  throw new Error(
    "@openledger-fleet/openledger is server-only: it spawns the `oled` CLI.",
  );
}

const OLED_BIN = "oled";

// Statement batches and full-ledger reads comfortably exceed the 1MB default.
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Two lanes, not one: `ingest prepare` can hold a statement for minutes under
 * OCR, and a single queue would block every read behind it — overlaps can
 * still race at each database open (BUSY_OPEN).
 */
const LANES = { fast: createSerialQueue(), slow: createSerialQueue() };

export type OledLane = keyof typeof LANES;

/** Flags whose following argument must never reach a log, a UI, or an error. */
const SECRET_FLAGS = new Set(["--password"]);

const MASK = "•••";

const maskArgv = (argv: string[]): string[] =>
  argv.map((arg, index) =>
    SECRET_FLAGS.has(argv[index - 1] ?? "") ? MASK : arg,
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

/**
 * `oled`'s WAL pragma takes a brief exclusive lock on every open; a second
 * process opening at that instant is refused and reported as a corrupt
 * database on exit 3 — not real corruption, hence the retry.
 */
const BUSY_OPEN = "is corrupt or is not a database";

const OPEN_RETRY_DELAYS_MS = [25, 75, 150];

const spawnRetryingBusyOpen = async (
  argv: string[],
  stdin?: string,
): Promise<SpawnOutcome> => {
  let outcome = await spawnOled(argv, stdin);
  for (const ms of OPEN_RETRY_DELAYS_MS) {
    if (outcome.exitCode !== 3 || !outcome.stderr.includes(BUSY_OPEN)) break;
    await delay(ms);
    outcome = await spawnOled(argv, stdin);
  }
  return outcome;
};

const toSpawnError = (code: string): OledError => {
  if (code === "ENOENT") {
    return {
      kind: "spawn_failed",
      message: `\`${OLED_BIN}\` was not found on PATH.`,
      hint: "Install the OpenLedger data plane: `pnpm add -g @aquartier/openledger`.",
    };
  }
  return {
    kind: "spawn_failed",
    message: `Failed to spawn \`${OLED_BIN}\`: ${code}`,
  };
};

const toExitError = (outcome: SpawnOutcome, argv: string[]): OledError => {
  const kind: OledErrorKind = EXIT_KIND[outcome.exitCode] ?? "cli_error";
  const cliError = parseCliErrorLine(outcome.stderr);
  if (!cliError) {
    return {
      kind,
      message:
        outcome.stderr.trim() ||
        `\`${OLED_BIN} ${argv[0] ?? ""}\` exited ${String(outcome.exitCode)}`,
      exitCode: outcome.exitCode,
    };
  }
  return {
    kind,
    message: cliError.message,
    ...(cliError.hint === undefined ? {} : { hint: cliError.hint }),
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
  const outcome = await spawnRetryingBusyOpen(argv, stdin).catch(
    (cause: unknown) => ({
      stdout: "",
      stderr: cause instanceof Error ? cause.message : String(cause),
      exitCode: -1,
      spawnError: "ESPAWN",
    }),
  );

  if (outcome.spawnError !== undefined) {
    return { result: err(toSpawnError(outcome.spawnError)), exitCode: -1 };
  }
  if (outcome.exitCode === 0)
    return { result: ok(outcome.stdout), exitCode: 0 };
  // Exit 7 wrote its results to stdout; the caller decides what a partial run means.
  if (outcome.exitCode === 7 && allowPartial) {
    return { result: ok(outcome.stdout), exitCode: 7 };
  }

  return {
    result: err(toExitError(outcome, argv)),
    exitCode: outcome.exitCode,
  };
};

let lastCommandId = 0;

// The listener is caller code on the command path: its failure is not the command's.
const notify = (
  listener: OledCommandListener | undefined,
  event: OledCommandEvent,
): void => {
  if (!listener) return;
  try {
    listener(event);
  } catch {
    return;
  }
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
  LANES[opts.lane](async () => {
    const id = ++lastCommandId;
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

export interface RunOledOptions {
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
