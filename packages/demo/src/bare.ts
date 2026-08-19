import { mkdir } from "node:fs/promises";

import { createOpenLedger } from "@openledger-cfo/openledger";

import type { LedgerConfig } from "./ledger";
import { bootstrapLedger, LEDGER } from "./ledger";
import { clearPlans } from "./plans";
import { describeError, log } from "./report";

/**
 * Shared trunk of `empty` and `reset`: bare ledger, emptied plans. `demo` is
 * the same flow with the dataset on top.
 */
export const runBare = async (config: LedgerConfig): Promise<number> => {
  const oled = createOpenLedger({ configPath: LEDGER.configPath });
  const emptied = await bootstrapLedger(oled, {
    config,
    accounts: [],
    merchants: [],
    keep: false,
    log,
  });
  if (!emptied.ok) {
    log(describeError(emptied.error));
    return 1;
  }
  // Uploads write straight into the data dir; init leaves it to be made lazily.
  await mkdir(LEDGER.dataDir, { recursive: true });

  clearPlans();
  log("plans   budgets, goals, reminders, insight state emptied");

  const status = await oled.status();
  if (!status.ok) {
    log(describeError(status.error));
    return 1;
  }
  const counts = status.value.counts;
  log(
    counts
      ? `ledger  ${String(counts.accounts)} accounts, ${String(counts.transactions)} transactions, ${String(counts.merchants)} merchants`
      : "ledger  configured, but status reported no counts — check the database",
  );
  return 0;
};
