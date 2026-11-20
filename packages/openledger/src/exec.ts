import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { win32 } from "node:path";
import type { z } from "zod/v4";
import { EXIT } from "@aquartier/openledger/contract";
import { attempt, delay, isPlainObject, noop } from "es-toolkit";

import type { OledError } from "./errors";
import type { ListPage } from "./ndjson";
import type { Result } from "./result";
import { maskArgv, OLED_BIN, OUTPUT_FLAGS, toFinalArgv } from "./argv";
import { EXIT_KIND, parseCliErrorLine } from "./errors";
import { parseNdjsonRows, parseSingle } from "./ndjson";
import { andThen, err, messageOf, ok } from "./result";

// Spawning a CLI is impossible in a browser bundle; fail at import rather than at first call.
if ("window" in globalThis) {
  throw new Error(
    "@openledger-cfo/openledger is server-only: it spawns the `oled` CLI.",
  );
}

// Statement batches and full-ledger reads comfortably exceed the 1MB default.
const MAX_BUFFER = 64 * 1024 * 1024;

type OledLane = "fast" | "slow";

/** Runs tasks one at a time; a failed task releases the queue like a finished one. */
const createSerialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(noop, noop);
    return run;
  };
};

// Serialized because the ledger is SQLite with one writer, and in two lanes so a long `ingest
// prepare` never blocks reads. Module scope: every connector shares the lanes and the event ids.
const createLanes = () => {
  const lanes = { fast: createSerialQueue(), slow: createSerialQueue() };
  let lastId = 0;
  return <T>(lane: OledLane, task: (id: number) => Promise<T>): Promise<T> =>
    lanes[lane](() => task(++lastId));
};

const inLane = createLanes();

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

// Windows installs `oled.cmd`; execFile needs a shell for it, which re-parses passwords
// (CVE-2024-27980). So run the shim's script under this Node, and refuse when this is not Node.
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

// Resolved per command, like execvp: an `npm install -g` mid-run reaches the next command.
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

// E_BUSY is safe to re-run, writes included, unless `details.resume_from_index` says a commit
// already posted rows or stdout already holds output: either means the write landed.
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

/** The ledger a connector runs against, and who hears about each command. */
export interface RunContext {
  configPath: string;
  onCommand?: OledCommandListener;
}

export interface RunOledOptions extends RunContext {
  stdin?: string;
  /** Return stdout instead of an error when the command exits 7 (partial). */
  allowPartial?: boolean;
  lane?: OledLane;
}

const runOled = (
  args: string[],
  opts: RunOledOptions,
): Promise<Result<string, OledError>> =>
  runObserved(toFinalArgv(args, opts.configPath), {
    stdin: opts.stdin,
    allowPartial: opts.allowPartial ?? false,
    lane: opts.lane ?? "fast",
    onCommand: opts.onCommand,
  });

export const runSingle = async <T>(
  args: string[],
  schema: z.ZodType<T>,
  opts: RunOledOptions,
): Promise<Result<T, OledError>> =>
  andThen(await runOled(args, opts), (stdout) => parseSingle(schema, stdout));

export const runList = async <TRow, TSummary>(
  args: string[],
  rowSchema: z.ZodType<TRow>,
  summarySchema: z.ZodType<TSummary>,
  opts: RunOledOptions,
): Promise<Result<ListPage<TRow, TSummary>, OledError>> =>
  andThen(await runOled(args, opts), (stdout) =>
    parseNdjsonRows(rowSchema, stdout, summarySchema),
  );

/**
 * `oled config` takes its config file as a positional argument and rejects
 * `--config`, so it cannot go through runOled.
 */
export const runOledConfig = (
  args: string[],
  opts: { stdin?: string; onCommand?: OledCommandListener } = {},
): Promise<Result<string, OledError>> =>
  runObserved([...args, ...OUTPUT_FLAGS], {
    stdin: opts.stdin,
    allowPartial: false,
    lane: "fast",
    onCommand: opts.onCommand,
  });
