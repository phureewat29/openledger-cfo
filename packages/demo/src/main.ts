import { parseArgs } from "node:util";

import { closeDb } from "@openledger-fleet/db/client";
import { createOpenLedger } from "@openledger-fleet/openledger";

import { cliArgs } from "./argv";
import { readLife } from "./dataset";
import { checkInvariants } from "./invariants";
import { LEDGER } from "./ledger";
import { loadLife } from "./load";
import { seedPlans } from "./plans";
import { describeError, log, printChecks } from "./report";
import { verifyLedger } from "./verify";

/**
 * The loading path draws no random numbers, and the dataset on disk is the
 * whole input for the ledger content, so a rerun writes the same ledger both
 * times. Seeding plans is the exception: it calls `isoToday()` for reminder
 * due-date math, so only reminder due dates can differ between runs made on
 * different days.
 */
const run = async (): Promise<number> => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: { keep: { type: "boolean", default: false } },
  });

  const dataset = await readLife();
  if (!dataset.ok) {
    log(describeError(dataset.error));
    return 1;
  }
  const life = dataset.value;
  const expected = life.meta.expected;

  log(
    `dataset variant ${String(life.meta.variant)}: ${String(expected.rows)} rows / ${String(expected.transactions)} legs over ${String(expected.counts.months)} months (${life.meta.window.start} .. ${life.meta.window.end})`,
  );

  const invariants = checkInvariants(life);

  const oled = createOpenLedger({ configPath: LEDGER.configPath });
  const loaded = await loadLife(oled, life, { keep: values.keep, log });
  if (!loaded.ok) {
    log(describeError(loaded.error));
    return 1;
  }

  const verified = await verifyLedger(oled, life);
  if (!verified.ok) {
    log(describeError(verified.error));
    return 1;
  }

  const plans = await seedPlans(life);
  if (!plans.ok) {
    log(plans.error);
    return 1;
  }

  log("");
  for (const fact of verified.value.facts) log(fact);
  log("");
  log(
    `${"plans".padEnd(19)}${String(plans.value.budgets)} budgets, ${String(plans.value.goals)} goals, ${String(plans.value.reminders)} reminders`,
  );
  log("");
  return printChecks([
    ...invariants,
    ...verified.value.checks,
    ...plans.value.checks,
  ]) === 0
    ? 0
    : 1;
};

// The one process boundary: everything below the pipeline reports failure as data.
try {
  process.exitCode = await run();
} catch (cause) {
  console.error(cause);
  process.exitCode = 1;
} finally {
  await closeDb();
}
