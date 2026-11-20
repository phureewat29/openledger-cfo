import { parseArgs } from "node:util";
import { z } from "zod/v4";

import { cliArgs } from "./argv";
import { LIFE_PATH, lifeSchema, writeLife } from "./dataset";
import { buildLife } from "./gen";
import { monthlyNets } from "./invariants";
import { proveLife } from "./load";
import { formatMoney } from "./money";
import { describeError, exitWith, log, printChecks } from "./report";

interface CliArgs {
  variant: number;
  keep: boolean;
}

const readArgs = (): CliArgs => {
  const { values } = parseArgs({
    args: cliArgs(),
    options: {
      variant: { type: "string", default: "1" },
      keep: { type: "boolean", default: false },
    },
  });

  const variant = Number(values.variant);
  if (!Number.isInteger(variant) || variant < 1) {
    throw new Error("--variant must be a positive integer");
  }
  return { variant, keep: values.keep };
};

// A dataset that fails any check is never written, so the committed file was green when made.
const run = async (): Promise<number> => {
  const args = readArgs();
  const life = buildLife(args.variant);
  const expected = life.meta.expected;

  log(
    `build   variant ${String(args.variant)}: ${String(expected.rows)} rows / ${String(expected.transactions)} legs over ${String(expected.counts.months)} months (${life.meta.window.start} .. ${life.meta.window.end})`,
  );
  log(
    `        ${(expected.rows / expected.counts.months).toFixed(1)} rows per month, ${String(expected.counts.accounts)} accounts, ${String(expected.counts.merchants)} merchants`,
  );

  const validated = lifeSchema.safeParse(life);
  if (!validated.success) {
    log(z.prettifyError(validated.error));
    return 1;
  }

  const proven = await proveLife(life, args.keep);
  if (!proven.ok) {
    log(describeError(proven.error));
    return 1;
  }

  log("");
  for (const fact of proven.value.facts) log(fact);
  log("");
  log(`month     income      expenses         net`);
  for (const month of monthlyNets(life)) {
    log(
      `${month.month}${month.full ? " " : "*"} ${formatMoney(month.income).padStart(12)}${formatMoney(month.expenses).padStart(14)}${formatMoney(month.net).padStart(12)}`,
    );
  }
  log("");
  const failed = printChecks(proven.value.checks);
  if (failed > 0) {
    log(`\nrefusing to write ${LIFE_PATH}`);
    return 1;
  }

  const bytes = await writeLife(life);
  log(`\nwrote   ${LIFE_PATH}  (${(bytes / 1_048_576).toFixed(2)} MB)`);
  return 0;
};

await exitWith(run);
