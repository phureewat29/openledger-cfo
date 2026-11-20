import { mkdir } from "node:fs/promises";

import type { LedgerConfig } from "./dataset";
import { bootstrapLedger, LEDGER, openDemoLedger } from "./ledger";
import { clearPlans } from "./plans";
import { describeError, log } from "./report";

export const runBare = async (config: LedgerConfig): Promise<number> => {
  const oled = openDemoLedger();
  const emptied = await bootstrapLedger(oled, {
    config,
    accounts: [],
    merchants: [],
    keep: false,
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
