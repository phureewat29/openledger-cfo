/**
 * pnpm and turbo forward extra arguments behind a bare `--`, which parseArgs
 * would otherwise read as the start of positional arguments and reject.
 */
export const cliArgs = (): string[] => {
  const argv = process.argv.slice(2);
  return argv[0] === "--" ? argv.slice(1) : argv;
};
