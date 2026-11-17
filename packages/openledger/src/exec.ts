import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { win32 } from "node:path";
import { EXIT } from "@aquartier/openledger/contract";
import { attempt, delay, isPlainObject } from "es-toolkit";

import type { OledError } from "./errors";
import type { Result } from "./result";
import { EXIT_KIND, parseCliErrorLine } from "./errors";
import { err, messageOf, ok } from "./result";
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
 * Module scope on purpose: every connector reaches the same ledger file, so all
 * the connectors one instance of this module builds share the lanes that
 * serialize it, and one id sequence keeps a listener shared between them from
 * pairing one command's start with another's end. A bundler that evaluates the
 * module twice makes a second set of lanes, so a caller that needs one queue
 * per process holds one connector per process.
 *
 * Two lanes, not one: a long `ingest prepare` would otherwise block every read
 * behind it. Overlaps can still contend for the ledger lock (exit 8, retried
 * below).
 */
const createLanes = () => {
  const lanes = { fast: createSerialQueue(), slow: createSerialQueue() };
  let lastId = 0;
  return <T>(lane: OledLane, task: (id: number) => Promise<T>): Promise<T> =>
    lanes[lane](() => task(++lastId));
};

const inLane = createLanes();

/** Flags whose following argument must never reach a log, a UI, or an error. */
const SECRET_FLAGS = new Set(["--password"]);

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

/** How a spawn starts the CLI: by its bare name, or as Node running a script. */
export interface OledLauncher {
  readonly file: string;
  readonly prefix: readonly string[];
  /** A Windows shim on PATH that named no script this could run. */
  readonly unreadShim?: string;
}

const BARE: OledLauncher = { file: OLED_BIN, prefix: [] };

/** The machine as the launcher reads it, injected so the Windows walk runs anywhere. */
export interface LauncherHost {
  readonly platform: NodeJS.Platform;
  readonly versions: Readonly<Record<string, string | undefined>>;
  readonly path: string | undefined;
  readonly execPath: string;
  readonly exists: (file: string) => boolean;
  readonly read: (file: string) => string | undefined;
}

/**
 * The quoted script just before `%*`: npm anchors it at `%dp0%\`, pnpm at
 * `%~dp0\` or, across drives, writes it absolute, and pnpm doubles each `%`.
 */
const SHIM_SCRIPT = /"(%dp0%\\|%~dp0\\)?([^"]+\.[cm]?js)"\s+%\*/i;

export const scriptOfShim = (shim: string, dir: string): string | undefined => {
  const match = SHIM_SCRIPT.exec(shim);
  if (match === null) return undefined;
  const [, anchor, target = ""] = match;
  const script = target.replaceAll("%%", "%");
  if (anchor !== undefined) return win32.join(dir, script);
  return win32.isAbsolute(script) ? script : undefined;
};

// Within one PATH directory an `.exe` (Volta's shim) wins, as it does for cmd.exe.
const WINDOWS_NAMES = ["oled.exe", "oled.cmd"];

/** Runtimes whose `execPath` is no Node to run a shim's script with. */
const NOT_NODE = [
  ["bun", "Bun"],
  ["electron", "Electron"],
] as const;

/**
 * npm and pnpm install `oled` on Windows as `oled.cmd`. execFile cannot start a
 * `.cmd` without a shell (CVE-2024-27980), and a shell re-parses every
 * argument, passwords included. So Windows runs the script the shim names under
 * this Node, refuses outright when this process is not Node, and leaves
 * anything else to execFile under the bare name.
 */
export const resolveOledLauncher = (
  host: LauncherHost,
): Result<OledLauncher, OledError> => {
  if (host.platform !== "win32") return ok(BARE);
  const found = (host.path ?? "")
    .split(win32.delimiter)
    .map((dir) => dir.replaceAll('"', ""))
    .filter((dir) => dir !== "")
    .flatMap((dir) => WINDOWS_NAMES.map((name) => win32.join(dir, name)))
    .find((file) => host.exists(file));
  if (!found?.endsWith(".cmd")) return ok(BARE);

  const runtime = NOT_NODE.find(([key]) => host.versions[key] !== undefined);
  if (runtime !== undefined) {
    return err({
      kind: "spawn_failed",
      message: `\`${OLED_BIN}\` is on PATH as ${found}, whose script needs Node, but this process runs under ${runtime[1]}.`,
      hint: "Start the app with Node.",
    });
  }

  const shim = host.read(found);
  const script =
    shim === undefined ? undefined : scriptOfShim(shim, win32.dirname(found));
  return ok(
    script !== undefined && host.exists(script)
      ? { file: host.execPath, prefix: [script] }
      : { ...BARE, unreadShim: found },
  );
};

const readText = (file: string): string | undefined =>
  attempt(() => readFileSync(file, "utf8"))[1] ?? undefined;

/**
 * Resolved per command, as execvp and libuv resolve a bare name: an
 * `npm install -g` while the app runs reaches the next command, as the setup
 * card promises.
 */
const launcherOf = (): Result<OledLauncher, OledError> =>
  resolveOledLauncher({
    platform: process.platform,
    versions: process.versions,
    path: process.env.PATH,
    execPath: process.execPath,
    exists: existsSync,
    read: readText,
  });

export interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  spawnError?: string;
}

const spawnOled = (
  launcher: OledLauncher,
  argv: string[],
  stdin?: string,
): Promise<SpawnOutcome> =>
  new Promise<SpawnOutcome>((resolve) => {
    const child = execFile(
      launcher.file,
      [...launcher.prefix, ...argv],
      { maxBuffer: MAX_BUFFER, encoding: "utf8", windowsHide: true },
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

const BUSY_RETRY_DELAYS_MS = [25, 75, 150];

/**
 * E_BUSY: another process held the ledger past the CLI's own ~5s wait. Per
 * oled's contract the same command is then safe to re-run, writes
 * included, unless the error carries `details.resume_from_index` (an `ingest
 * commit` that had already posted rows, which a re-run would post twice
 * wherever a row has no stable id) or stdout already holds output. Both signals
 * come from the CLI: a write that landed and printed nothing would run twice.
 */
const isRetryableBusy = ({
  exitCode,
  stdout,
  stderr,
}: SpawnOutcome): boolean => {
  if (exitCode !== EXIT.BUSY || stdout !== "") return false;
  const details = parseCliErrorLine(stderr)?.details;
  return !(
    isPlainObject(details) && Object.hasOwn(details, "resume_from_index")
  );
};

/** Spawns again after each delay in turn while the outcome is a busy exit a re-run can wait out. */
export const retryingBusy = async (
  spawn: () => Promise<SpawnOutcome>,
  delays: readonly number[] = BUSY_RETRY_DELAYS_MS,
): Promise<SpawnOutcome> => {
  const outcome = await spawn();
  const [wait, ...rest] = delays;
  if (!isRetryableBusy(outcome) || wait === undefined) return outcome;
  await delay(wait);
  return retryingBusy(spawn, rest);
};

const toSpawnError = (code: string, launcher: OledLauncher): OledError => {
  if (code === "ENOENT" && launcher.unreadShim !== undefined) {
    return {
      kind: "spawn_failed",
      message: `\`${OLED_BIN}\` is on PATH as ${launcher.unreadShim}, which names no script this app can run.`,
      hint: `Install oled with npm: \`npm install -g @aquartier/openledger\`. If ${launcher.unreadShim} still comes first on PATH, put npm's global bin ahead of it.`,
    };
  }
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
  const resolved = launcherOf();
  if (!resolved.ok) return { result: resolved, exitCode: -1 };
  const launcher = resolved.value;
  const outcome = await retryingBusy(() =>
    spawnOled(launcher, argv, stdin),
  ).catch((cause: unknown): SpawnOutcome => ({
    stdout: "",
    stderr: "",
    exitCode: -1,
    spawnError: `ESPAWN: ${messageOf(cause)}`,
  }));

  if (outcome.spawnError !== undefined) {
    return {
      result: err(toSpawnError(outcome.spawnError, launcher)),
      exitCode: -1,
    };
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
