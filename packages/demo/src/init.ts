import { parseArgs } from "node:util";

import { createOpenLedger } from "@openledger-fleet/openledger";

import { cliArgs } from "./argv";
import { readLife } from "./dataset";
import { bootstrapLedger, LEDGER } from "./ledger";
import { describeError, log } from "./report";

/** Creates the repo-local demo ledger with the dataset's chart and merchants, but no transactions. */
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

  const oled = createOpenLedger({ configPath: LEDGER.configPath });
  const bootstrapped = await bootstrapLedger(oled, {
    config: dataset.value.meta.config,
    accounts: dataset.value.accounts,
    merchants: dataset.value.merchants,
    keep: values.keep,
    log,
  });
  if (!bootstrapped.ok) {
    log(describeError(bootstrapped.error));
    return 1;
  }

  const status = await oled.status();
  if (!status.ok) {
    log(describeError(status.error));
    return 1;
  }

  log(
    `ready   ${String(status.value.counts?.accounts)} accounts, ${String(status.value.counts?.merchants)} merchants, ${String(status.value.counts?.transactions)} transactions`,
  );
  log(`config  ${status.value.config_path}`);
  return 0;
};

try {
  process.exitCode = await run();
} catch (cause) {
  console.error(cause);
  process.exitCode = 1;
}
