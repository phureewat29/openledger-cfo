import type { OledError } from "@openledger-cfo/openledger";

import type { Check } from "./invariants";

export const log = (line: string): void => {
  console.log(line);
};

export const describeError = (error: OledError): string =>
  [
    `${error.kind}: ${error.message}`,
    error.hint === undefined ? "" : `  hint: ${error.hint}`,
    ...(error.failures ?? [])
      .slice(0, 10)
      .map((failure) => `  ${JSON.stringify(failure)}`),
  ]
    .filter(Boolean)
    .join("\n");

/** Returns how many failed, so a caller can turn that into an exit code. */
export const printChecks = (checks: Check[]): number => {
  const width = Math.max(...checks.map((entry) => entry.name.length));
  for (const entry of checks) {
    const detail = entry.detail === "" ? "" : `  ${entry.detail}`;
    log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.name.padEnd(width)}${detail}`);
  }
  const failed = checks.filter((entry) => !entry.ok).length;
  log(
    `\n${String(checks.length - failed)}/${String(checks.length)} checks passed${failed === 0 ? "" : `, ${String(failed)} FAILED`}`,
  );
  return failed;
};
