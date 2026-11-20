import type { RouterOutputs } from "@openledger-cfo/api";

/** One shape for a CLI log entry, derived from the read that produces it. */
export type CliEntry = RouterOutputs["ledger"]["cliLog"]["entries"][number];

// The api ring's capacity, restated: importing the api would pull the `oled` connector into the browser bundle.
export const CLI_LOG_WINDOW = 200;

/** A stable reference, so a missing read does not allocate a fresh array on every render. */
export const NO_ENTRIES: CliEntry[] = [];

/** "exit 0 · 1.2s", the duration left off while it is unknown. */
export const exitLine = (entry: CliEntry): string =>
  `exit ${entry.exitCode}${
    entry.durationMs === null
      ? ""
      : ` · ${(entry.durationMs / 1000).toFixed(1)}s`
  }`;

/** Transport flags say nothing about the work; the full argv stays in the title. */
const TRANSPORT_FLAGS = /\s--(?:json|no-color|no-redact)\b|\s--config\s+\S+/g;

/** The pollers' own reads: the app's pulse, not work. */
const POLL_ARGV = ["questions list", "ingest list"];

const isPoll = (entry: CliEntry) =>
  POLL_ARGV.some((argv) => entry.line.includes(argv));

/** The newest command that is somebody's work, else the newest of any kind. */
export const newestUseful = (
  entries: readonly CliEntry[],
): CliEntry | undefined =>
  entries.findLast((entry) => !isPoll(entry)) ?? entries.at(-1);

export const commandText = (entry: CliEntry): string =>
  entry.line.replace(TRANSPORT_FLAGS, "").trim();
