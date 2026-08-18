import { parseArgs } from "node:util";
import { z } from "zod/v4";

import { createOpenLedger } from "@openledger-cfo/openledger";

import { cliArgs } from "./argv";
import { buildLife } from "./build";
import { LIFE_PATH, lifeSchema, writeLife } from "./dataset";
import { checkInvariants, monthlyNets } from "./invariants";
import { LEDGER } from "./ledger";
import { loadLife } from "./load";
import { formatMoney } from "./money";
import { describeError, log, printChecks } from "./report";
import { verifyLedger } from "./verify";

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

/**
 * The authoring path. It builds a dataset, proves it against the pure invariants
 * and against a ledger it actually loads, and only then writes the file the
 * loading path will read. A dataset that fails anything is never written, so the
 * committed file is one that was green when it was made.
 */
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

  const invariants = checkInvariants(life);

  const oled = createOpenLedger({ configPath: LEDGER.configPath });
  const loaded = await loadLife(oled, life, { keep: args.keep, log });
  if (!loaded.ok) {
    log(describeError(loaded.error));
    return 1;
  }

  const verified = await verifyLedger(oled, life);
  if (!verified.ok) {
    log(describeError(verified.error));
    return 1;
  }

  log("");
  for (const fact of verified.value.facts) log(fact);
  log("");
  log(`month     income      expenses         net`);
  for (const month of monthlyNets(life)) {
    log(
      `${month.month}${month.full ? " " : "*"} ${formatMoney(month.income).padStart(12)}${formatMoney(month.expenses).padStart(14)}${formatMoney(month.net).padStart(12)}`,
    );
  }
  log("");
  const failed = printChecks([...invariants, ...verified.value.checks]);
  if (failed > 0) {
    log(`\nrefusing to write ${LIFE_PATH}`);
    return 1;
  }

  const bytes = await writeLife(life);
  log(`\nwrote   ${LIFE_PATH}  (${(bytes / 1_048_576).toFixed(2)} MB)`);
  return 0;
};

// The one process boundary: everything below the pipeline reports failure as data.
try {
  process.exitCode = await run();
} catch (cause) {
  console.error(cause);
  process.exitCode = 1;
}
