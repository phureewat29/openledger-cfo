import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type {
  AccountCreateInput,
  MerchantUpsertInput,
  OledError,
  OpenLedger,
  Result,
} from "@openledger-fleet/openledger";
import { err, ok } from "@openledger-fleet/openledger";

import type { Life } from "./dataset";

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

const readOcrConfig = (
  path: string,
): { ocrBaseUrl?: string; ocrModel?: string } => {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    const ocrBaseUrl = parsed.ocrBaseUrl;
    const ocrModel = parsed.ocrModel;
    return {
      ...(typeof ocrBaseUrl === "string" && ocrBaseUrl !== ""
        ? { ocrBaseUrl }
        : {}),
      ...(typeof ocrModel === "string" && ocrModel !== "" ? { ocrModel } : {}),
    };
  } catch {
    return {};
  }
};

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

interface BootstrapOptions {
  config: Life["meta"]["config"];
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

/** Everything the ledger is given comes from the dataset, so no persona module is consulted. */
export const bootstrapLedger = async (
  oled: OpenLedger,
  options: BootstrapOptions,
): Promise<Result<BootstrapReport, OledError>> => {
  const guard = guardDemoLedger();
  if (!guard.ok) return guard;

  // The OCR endpoint is a machine setting, not a dataset fact: carry it across
  // the reset so a reseed never turns image ingest off.
  const ocr = readOcrConfig(LEDGER.configPath);

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
      ...ocr,
    });
    if (!init.ok) return init;
    options.log(`config  ${init.value.config_path}`);
  }

  const chart = await oled.bootstrap.accountsCreateBatch(options.accounts);
  if (!chart.ok) return chart;
  options.log(
    `chart   ${String(chart.value.summary.created)} created, ${String(chart.value.summary.duplicates)} already present`,
  );

  for (const merchant of options.merchants) {
    const upserted = await oled.bootstrap.merchantsUpsert(merchant);
    if (!upserted.ok) return upserted;
  }
  options.log(`merchants ${String(options.merchants.length)} upserted`);

  return ok({
    accountsCreated: chart.value.summary.created,
    accountsDuplicate: chart.value.summary.duplicates,
    merchants: options.merchants.length,
  });
};
