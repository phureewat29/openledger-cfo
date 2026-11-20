import { isPlainObject } from "es-toolkit";

export const OLED_BIN = "oled";

export const OUTPUT_FLAGS = ["--json", "--no-color"] as const;

/** Flags whose following argument must never reach a log, a UI, or an error. */
const SECRET_FLAGS = new Set(["--password"]);

/** What stands in for a secret in a log, a UI, or an error. */
export const SECRET_MASK = "•••";

export const maskArgv = (argv: string[]): string[] =>
  argv.map((arg, index) =>
    SECRET_FLAGS.has(argv[index - 1] ?? "") ? SECRET_MASK : arg,
  );

export const toFinalArgv = (args: string[], configPath: string): string[] => [
  ...args,
  ...OUTPUT_FLAGS,
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
