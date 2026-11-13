import { describe, expect, it, vi } from "vitest";

import type { LauncherHost, SpawnOutcome } from "./exec";
import { resolveOledLauncher, retryingBusy, scriptOfShim } from "./exec";

/** npm 11's cmd-shim 8.0.0, for `npm install -g` into the default prefix. */
const NPM_GLOBAL = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js" %*',
  "",
].join("\r\n");

/**
 * pnpm 11.28.9's workspace bin under a non-ASCII account and a `%` in the path:
 * the codepage wrapper and NODE_PATH block surround the call.
 */
const PNPM_WORKSPACE = [
  "@SETLOCAL",
  '@SET "_PNPM_CODEPAGE="',
  '@FOR /F "tokens=2 delims=:" %%a IN (\'"%SystemRoot%\\System32\\chcp.com"\') DO @SET "_PNPM_CODEPAGE=%%a"',
  '@"%SystemRoot%\\System32\\chcp.com" 65001 >NUL',
  '@SET "ERRORLEVEL="',
  "@IF NOT DEFINED NODE_PATH (",
  '  @SET "NODE_PATH=C:\\Users\\ครัวซองต์\\100%%\\openledger-cfo\\node_modules\\.pnpm\\@aquartier+openledger@0.25.0\\node_modules\\@aquartier\\openledger\\node_modules;C:\\Users\\ครัวซองต์\\100%%\\openledger-cfo\\node_modules\\.pnpm\\@aquartier+openledger@0.25.0\\node_modules;C:\\Users\\ครัวซองต์\\100%%\\openledger-cfo\\node_modules\\.pnpm\\node_modules"',
  ") ELSE (",
  '  @SET "NODE_PATH=C:\\Users\\ครัวซองต์\\100%%\\openledger-cfo\\node_modules\\.pnpm\\@aquartier+openledger@0.25.0\\node_modules\\@aquartier\\openledger\\node_modules;C:\\Users\\ครัวซองต์\\100%%\\openledger-cfo\\node_modules\\.pnpm\\@aquartier+openledger@0.25.0\\node_modules;C:\\Users\\ครัวซองต์\\100%%\\openledger-cfo\\node_modules\\.pnpm\\node_modules;%NODE_PATH%"',
  ")",
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\..\\@aquartier\\openledger\\dist\\cli\\index.js" %*',
  ") ELSE (",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  '  node  "%~dp0\\..\\@aquartier\\openledger\\dist\\cli\\index.js" %*',
  ")",
  '@SET "_PNPM_EXIT_CODE=%ERRORLEVEL%"',
  '@IF DEFINED _PNPM_CODEPAGE @"%SystemRoot%\\System32\\chcp.com" %_PNPM_CODEPAGE% >NUL',
  "@EXIT /B %_PNPM_EXIT_CODE%",
  "",
].join("\r\n");

/** pnpm 11.28.9's global bin, whose script path holds a `%` it writes doubled. */
const PNPM_GLOBAL = [
  "@SETLOCAL",
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\global\\v11\\100%%\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js" %*',
  ") ELSE (",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  '  node  "%~dp0\\global\\v11\\100%%\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js" %*',
  ")",
  "",
].join("\r\n");

/** pnpm 11.28.9 with its script on another drive, which it writes absolute. */
const PNPM_CROSS_DRIVE = [
  "@SETLOCAL",
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "D:\\store\\links\\@aquartier\\openledger\\0.25.0\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js" %*',
  ") ELSE (",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  '  node  "D:\\store\\links\\@aquartier\\openledger\\0.25.0\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js" %*',
  ")",
  "",
].join("\r\n");

/** Volta before 1.1 wrote `.cmd` shims that hand off to itself. */
const VOLTA_CMD = "@echo off\r\nvolta run %~n0 %*\r\n";

const NPM_DIR = "C:\\Users\\alice\\AppData\\Roaming\\npm";
const NPM_SCRIPT = `${NPM_DIR}\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js`;
const NODE_EXE = "C:\\Program Files\\nodejs\\node.exe";

describe("scriptOfShim", () => {
  it.each([
    ["npm's global shim", NPM_GLOBAL, NPM_DIR, NPM_SCRIPT],
    [
      "pnpm's workspace shim",
      PNPM_WORKSPACE,
      "C:\\Users\\ครัวซองต์\\100%\\openledger-cfo\\packages\\openledger\\node_modules\\.bin",
      "C:\\Users\\ครัวซองต์\\100%\\openledger-cfo\\packages\\openledger\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js",
    ],
    [
      "pnpm's global shim",
      PNPM_GLOBAL,
      "C:\\Users\\alice\\AppData\\Local\\pnpm",
      "C:\\Users\\alice\\AppData\\Local\\pnpm\\global\\v11\\100%\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js",
    ],
    [
      "pnpm's cross-drive shim",
      PNPM_CROSS_DRIVE,
      "C:\\repo\\node_modules\\.bin",
      "D:\\store\\links\\@aquartier\\openledger\\0.25.0\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js",
    ],
  ])("reads the script out of %s", (_, shim, dir, script) => {
    expect(scriptOfShim(shim, dir)).toBe(script);
  });

  it.each([
    ["a shim that hands off to Volta", VOLTA_CMD],
    ["a shim that runs a binary", '@"%~dp0\\..\\oled\\bin\\oled.exe"   %*\r\n'],
    ["a relative script with no anchor", '@node "dist\\cli.js" %*\r\n'],
  ])("finds nothing in %s", (_, shim) => {
    expect(scriptOfShim(shim, NPM_DIR)).toBeUndefined();
  });
});

const windowsHost = (
  path: string,
  files: Readonly<Record<string, string>>,
): LauncherHost => ({
  platform: "win32",
  path,
  execPath: NODE_EXE,
  exists: (file) => Object.hasOwn(files, file),
  read: (file) => files[file],
});

describe("resolveOledLauncher", () => {
  it.each(["darwin", "linux"] as const)(
    "leaves %s to execFile under the bare name, reading nothing",
    (platform) => {
      const exists = vi.fn(() => true);
      const read = vi.fn(() => NPM_GLOBAL);
      const launcher = resolveOledLauncher({
        platform,
        path: NPM_DIR,
        execPath: "/usr/bin/node",
        exists,
        read,
      });

      expect(launcher).toEqual({ file: "oled", prefix: [] });
      expect(exists).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("runs the npm shim's script under this Node", () => {
    const launcher = resolveOledLauncher(
      windowsHost(`C:\\Windows\\system32;;${NPM_DIR}\\`, {
        [`${NPM_DIR}\\oled.cmd`]: NPM_GLOBAL,
        [NPM_SCRIPT]: "",
      }),
    );

    expect(launcher).toEqual({ file: NODE_EXE, prefix: [NPM_SCRIPT] });
  });

  it("takes the first PATH directory holding oled, quoted or not", () => {
    const nodeDir = "C:\\Program Files\\nodejs";
    const script = `${nodeDir}\\node_modules\\@aquartier\\openledger\\dist\\cli\\index.js`;
    const launcher = resolveOledLauncher(
      windowsHost(`"${nodeDir}";${NPM_DIR}`, {
        [`${nodeDir}\\oled.cmd`]: NPM_GLOBAL,
        [script]: "",
        [`${NPM_DIR}\\oled.cmd`]: NPM_GLOBAL,
        [NPM_SCRIPT]: "",
      }),
    );

    expect(launcher.prefix).toEqual([script]);
  });

  it("leaves an oled.exe ahead of any shim to execFile", () => {
    const volta = "C:\\Users\\alice\\AppData\\Local\\Volta\\bin";
    const launcher = resolveOledLauncher(
      windowsHost(`${volta};${NPM_DIR}`, {
        [`${volta}\\oled.exe`]: "",
        [`${NPM_DIR}\\oled.cmd`]: NPM_GLOBAL,
        [NPM_SCRIPT]: "",
      }),
    );

    expect(launcher).toEqual({ file: "oled", prefix: [] });
  });

  it("falls back to the bare name when oled is not on PATH", () => {
    expect(
      resolveOledLauncher(windowsHost("C:\\Windows\\system32", {})),
    ).toEqual({ file: "oled", prefix: [] });
    expect(resolveOledLauncher(windowsHost("", {}))).toEqual({
      file: "oled",
      prefix: [],
    });
  });

  it.each([
    ["names no script", { [`${NPM_DIR}\\oled.cmd`]: VOLTA_CMD }],
    ["names a missing script", { [`${NPM_DIR}\\oled.cmd`]: NPM_GLOBAL }],
  ])("keeps a shim that %s for the spawn error", (_, files) => {
    expect(resolveOledLauncher(windowsHost(NPM_DIR, files))).toEqual({
      file: "oled",
      prefix: [],
      unreadShim: `${NPM_DIR}\\oled.cmd`,
    });
  });
});

/** The stderr line oled 0.25's `describeFailure` writes for an E_BUSY under --json. */
const busyLine = (extra: object = {}) =>
  `${JSON.stringify({
    error: {
      code: "E_BUSY",
      message: "The ledger is in use by another process.",
      hint: "another oled process is using the ledger; re-run the same command in a moment",
      ...extra,
    },
  })}\n`;

const busy = (stderr: string): SpawnOutcome => ({
  stdout: "",
  stderr,
  exitCode: 8,
});

const PLAIN = busy(busyLine());

/** An `ingest commit` that lost the lock after posting two rows. */
const RESUMABLE = busy(
  busyLine({
    hint: "rows before index 2 already ran (2 posted, results above); re-run only the rows from index 2, since re-running them all would post rows without a stable id twice",
    details: { posted: 2, resume_from_index: 2 },
  }),
);

const UNRELATED = busy(busyLine({ details: { posted: 0 } }));

/** A busy exit after a row reached stdout, whatever its stderr names. */
const PRINTED: SpawnOutcome = {
  ...PLAIN,
  stdout:
    '{"type":"result","index":0,"ok":true,"transaction_id":"tx-7f3a","duplicate":false}\n',
};

const NOISY = busy(
  [
    "(node:4242) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.",
    "{ not json, though it opens like it",
    RESUMABLE.stderr,
  ].join("\n"),
);

const DONE: SpawnOutcome = {
  stdout: '{"ok":true}\n',
  stderr: "",
  exitCode: 0,
};

// Three retries, none of them waiting.
const NO_WAIT = [0, 0, 0];

describe("retryingBusy", () => {
  it.each<[string, SpawnOutcome[]]>([
    ["names resume_from_index", [RESUMABLE]],
    ["is plain", [PLAIN, PLAIN, PLAIN, PLAIN]],
    ["carries unrelated details", [UNRELATED, UNRELATED, UNRELATED, UNRELATED]],
    ["names resume_from_index amid other stderr", [NOISY]],
    ["printed a row first", [PRINTED]],
    ["clears on the next run", [PLAIN, DONE]],
  ])("spawns an exit 8 that %s as scripted", async (_, script) => {
    const spawn = script.reduce(
      (mock, outcome) => mock.mockResolvedValueOnce(outcome),
      vi
        .fn<() => Promise<SpawnOutcome>>()
        .mockRejectedValue(new Error("spawned past the script")),
    );

    expect(await retryingBusy(spawn, NO_WAIT)).toBe(script.at(-1));
    expect(spawn).toHaveBeenCalledTimes(script.length);
  });
});
