import { mkdir } from "node:fs/promises";

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
 * The command log, run journal and run slot live inside the app server, out
 * of this process's reach; a running server clears them on request, and an
 * absent one has nothing to clear. Rows already delivered to an open tab sit
 * in client state, which is what the reload hint is about.
 */
const clearServerState = async (): Promise<string> => {
  try {
    const response = await fetch("http://localhost:3001/api/reset", {
      method: "POST",
      signal: AbortSignal.timeout(1500),
    });
    return response.ok
      ? "server  logs and run state cleared — reload any open tab"
      : `server  answered ${String(response.status)} — restart it to clear the logs`;
  } catch {
    return "server  not running, nothing to clear";
  }
};

/**
 * The recovery hatch when the data has been manipulated past trusting: both
 * stores emptied rather than filled, the ledger keeping only what `oled`
 * itself seeds on init. Deliberately absent from the README — `demo` is the
 * documented way back to a known state. The dataset is still read: its meta
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
  // Uploads write straight into the data dir; init leaves it to be made lazily.
  await mkdir(LEDGER.dataDir, { recursive: true });

  await db.transaction(async (tx) => {
    await tx.delete(budget);
    await tx.delete(goal);
    await tx.delete(insightState);
    await tx.delete(reminder);
  });
  log("plans   budgets, goals, reminders, insight state emptied");
  log(await clearServerState());

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
