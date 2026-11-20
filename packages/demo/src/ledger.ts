import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type {
  AccountCreateInput,
  MerchantUpsertInput,
  OledError,
  OpenLedger,
  Result,
} from "@openledger-cfo/openledger";
import {
  createOpenLedger,
  err,
  ok,
  WORKSPACE_MARKER,
} from "@openledger-cfo/openledger";

import type { LedgerConfig } from "./dataset";
import { log } from "./report";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const LEDGER_ROOT = join(REPO_ROOT, ".oled");

/** The demo ledger is repo-local and disposable; the developer's own ~/.oled is not. */
export const LEDGER = {
  root: LEDGER_ROOT,
  configPath: join(LEDGER_ROOT, "config.json"),
  dbPath: join(LEDGER_ROOT, "ledger.db"),
  dataDir: join(LEDGER_ROOT, "data"),
  cacheDir: join(LEDGER_ROOT, "cache"),
} as const;

export const openDemoLedger = (): OpenLedger =>
  createOpenLedger({ configPath: LEDGER.configPath });

const guardDemoLedger = (): Result<true, OledError> => {
  if (!existsSync(join(REPO_ROOT, WORKSPACE_MARKER))) {
    return err<OledError>({
      kind: "invalid",
      message: `Refusing to touch ${LEDGER.root}: ${REPO_ROOT} is not the workspace root.`,
    });
  }
  if (LEDGER.root === join(homedir(), ".oled")) {
    return err<OledError>({
      kind: "invalid",
      message: "Refusing to touch the default ~/.oled ledger.",
    });
  }
  return ok(true);
};

interface BootstrapOptions {
  config: LedgerConfig;
  accounts: AccountCreateInput[];
  merchants: MerchantUpsertInput[];
  keep: boolean;
}

/** The config, chart and merchants all arrive as arguments; this module reads no dataset and no persona of its own. */
export const bootstrapLedger = async (
  oled: OpenLedger,
  options: BootstrapOptions,
): Promise<Result<true, OledError>> => {
  const guard = guardDemoLedger();
  if (!guard.ok) return guard;

  if (!options.keep) {
    // A running server can hold the ledger file for a moment; Windows answers EBUSY until it lets go.
    await rm(LEDGER.root, { recursive: true, force: true, maxRetries: 5 });
    log(`reset   ${LEDGER.root}`);
  }
  await mkdir(LEDGER.root, { recursive: true });

  if (!existsSync(LEDGER.configPath)) {
    const init = await oled.bootstrap.configInit({
      configPath: LEDGER.configPath,
      db: LEDGER.dbPath,
      dataDir: LEDGER.dataDir,
      cacheDir: LEDGER.cacheDir,
      country: options.config.country,
      currency: options.config.currency,
      locale: options.config.locale,
      userName: options.config.userName,
    });
    if (!init.ok) return init;
    log(`config  ${init.value.config_path}`);
  }

  // The CLI refuses an empty batch; zero accounts skips the call.
  const chart =
    options.accounts.length === 0
      ? ok({ summary: { created: 0, duplicates: 0 } })
      : await oled.bootstrap.accountsCreateBatch(options.accounts);
  if (!chart.ok) return chart;
  log(
    `chart   ${String(chart.value.summary.created)} created, ${String(chart.value.summary.duplicates)} already present`,
  );

  for (const merchant of options.merchants) {
    const upserted = await oled.bootstrap.merchantsUpsert(merchant);
    if (!upserted.ok) return upserted;
  }
  log(`merchants ${String(options.merchants.length)} upserted`);

  return ok(true);
};
