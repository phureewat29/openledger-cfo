import { parseArgs } from "node:util";

import { cliArgs } from "./argv";
import { readLife } from "./dataset";
import { proveLife } from "./load";
import { seedPlans } from "./plans";
import { describeError, exitWith, log, printChecks } from "./report";

// Reminder due dates follow `isoToday()`; everything else a rerun writes is identical.
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

  const proven = await proveLife(life, values.keep);
  if (!proven.ok) {
    log(describeError(proven.error));
    return 1;
  }

  const plans = seedPlans(life);
  if (!plans.ok) {
    log(plans.error);
    return 1;
  }

  log("");
  for (const fact of proven.value.facts) log(fact);
  log("");
  log(
    `${"plans".padEnd(19)}${String(plans.value.budgets)} budgets, ${String(plans.value.goals)} goals, ${String(plans.value.reminders)} reminders`,
  );
  log("");
  return printChecks([...proven.value.checks, ...plans.value.checks]) === 0
    ? 0
    : 1;
};

await exitWith(run);
