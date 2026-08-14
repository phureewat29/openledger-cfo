import { closeDb, db } from "@openledger-fleet/db/client";
import {
  budget,
  goal,
  insightState,
  reminder,
} from "@openledger-fleet/db/schema";
import { createOpenLedger } from "@openledger-fleet/openledger";

import { readLife } from "./dataset";
import { bootstrapLedger, LEDGER } from "./ledger";
import { describeError, log } from "./report";

/**
 * The inverse of `demo`: both stores emptied rather than filled. The ledger
 * keeps only what `oled` itself seeds on init, so an ingest test starts the
 * way a brand-new user's ledger would. The dataset is still read — its meta
 * carries the config the fresh ledger is initialized with.
 */
const run = async (): Promise<number> => {
  const dataset = await readLife();
  if (!dataset.ok) {
    log(describeError(dataset.error));
    return 1;
  }

  const oled = createOpenLedger({ configPath: LEDGER.configPath });
  const emptied = await bootstrapLedger(oled, {
    config: dataset.value.meta.config,
    accounts: [],
    merchants: [],
    keep: false,
    log,
  });
  if (!emptied.ok) {
    log(describeError(emptied.error));
    return 1;
  }

  await db.transaction(async (tx) => {
    await tx.delete(budget);
    await tx.delete(goal);
    await tx.delete(insightState);
    await tx.delete(reminder);
  });
  log("plans   budgets, goals, reminders, insight state emptied");

  const status = await oled.status();
  if (!status.ok) {
    log(describeError(status.error));
    return 1;
  }
  log(
    `ledger  ${String(status.value.counts?.accounts)} accounts, ${String(status.value.counts?.transactions)} transactions, ${String(status.value.counts?.merchants)} merchants`,
  );
  return 0;
};

try {
  process.exitCode = await run();
} catch (cause) {
  console.error(cause);
  process.exitCode = 1;
} finally {
  await closeDb();
}
