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
import { err, ok } from "@openledger-cfo/openledger";

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

const guardDemoLedger = (): Result<true, OledError> => {
  if (!existsSync(join(REPO_ROOT, "pnpm-workspace.yaml"))) {
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

/** The four facts `oled config --init` needs; the dataset and the persona both satisfy it. */
export interface LedgerConfig {
  readonly country: string;
  readonly currency: string;
  readonly locale: string;
  readonly userName: string;
}

interface BootstrapOptions {
  config: LedgerConfig;
  accounts: AccountCreateInput[];
  merchants: MerchantUpsertInput[];
  keep: boolean;
  log: (line: string) => void;
}

interface BootstrapReport {
  accountsCreated: number;
  accountsDuplicate: number;
  merchants: number;
}

/** The config, chart and merchants all arrive as arguments; this module reads no dataset and no persona of its own. */
export const bootstrapLedger = async (
  oled: OpenLedger,
  options: BootstrapOptions,
): Promise<Result<BootstrapReport, OledError>> => {
  const guard = guardDemoLedger();
  if (!guard.ok) return guard;

  // OCR is a machine setting: carried across the reset so a reseed never
  // turns image ingest off. Raw key included — re-init must replay it.
  const view = await oled.config.read();
  if (!view.ok && view.error.kind !== "not_configured") {
    options.log(
      `ocr config unreadable, continuing without it: ${view.error.message}`,
    );
  }
  const { ocrBaseUrl, ocrModel, ocrApiKey } = view.ok ? view.value : {};

  if (!options.keep) {
    await rm(LEDGER.root, { recursive: true, force: true });
    options.log(`reset   ${LEDGER.root}`);
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
      ocrBaseUrl,
      ocrModel,
      ocrApiKey,
    });
    if (!init.ok) return init;
    options.log(`config  ${init.value.config_path}`);
  }

  // The CLI refuses an empty batch; zero accounts skips the call.
  const summary = { created: 0, duplicates: 0 };
  if (options.accounts.length > 0) {
    const chart = await oled.bootstrap.accountsCreateBatch(options.accounts);
    if (!chart.ok) return chart;
    summary.created = chart.value.summary.created;
    summary.duplicates = chart.value.summary.duplicates;
  }
  options.log(
    `chart   ${String(summary.created)} created, ${String(summary.duplicates)} already present`,
  );

  for (const merchant of options.merchants) {
    const upserted = await oled.bootstrap.merchantsUpsert(merchant);
    if (!upserted.ok) return upserted;
  }
  options.log(`merchants ${String(options.merchants.length)} upserted`);

  return ok({
    accountsCreated: summary.created,
    accountsDuplicate: summary.duplicates,
    merchants: options.merchants.length,
  });
};
