import type { OledError, OpenLedger, Result } from "@openledger-cfo/openledger";
import { ok } from "@openledger-cfo/openledger";

import type { Life } from "./dataset";
import { bootstrapLedger } from "./ledger";

interface LoadOptions {
  keep: boolean;
  log: (line: string) => void;
}

interface LoadReport {
  posted: number;
  accounts: number;
  merchants: number;
}

/**
 * The whole loading path: reset, bootstrap from the dataset, then post one batch
 * per month in file order. Nothing here draws a random number or reads the
 * clock, so two runs of the same file produce the same ledger content.
 */
export const loadLife = async (
  oled: OpenLedger,
  life: Life,
  options: LoadOptions,
): Promise<Result<LoadReport, OledError>> => {
  const bootstrapped = await bootstrapLedger(oled, {
    config: life.meta.config,
    accounts: life.accounts,
    merchants: life.merchants,
    keep: options.keep,
    log: options.log,
  });
  if (!bootstrapped.ok) return bootstrapped;

  let running = 0;
  for (const chunk of life.months) {
    const posted = await oled.bootstrap.ingestCommitBatch(chunk.rows);
    if (!posted.ok) return posted;
    running += posted.value.summary.posted;
    options.log(
      `post ${chunk.month}  ${String(chunk.rows.length).padStart(4)} rows  running ${String(running).padStart(5)}`,
    );
  }

  return ok({
    posted: running,
    accounts: bootstrapped.value.accountsCreated,
    merchants: bootstrapped.value.merchants,
  });
};
