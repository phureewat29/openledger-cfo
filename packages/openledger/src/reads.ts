import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod/v4";
import { CONTRACT_VERSION } from "@aquartier/openledger/contract";

import type { OledConfigFile } from "./config";
import type { OledError } from "./errors";
import type { OledCommandListener } from "./exec";
import type { ListPage } from "./ndjson";
import type { Result } from "./result";
import type {
  AccountMatchRow,
  AccountMatchSummary,
  AccountRow,
  AccountTreeNode,
  AccountType,
  CountSummary,
  IngestFileRow,
  IngestFileSummary,
  MerchantRow,
  PageSummary,
  QuestionRow,
  Report,
  Status,
  TransactionRow,
  TreeSummary,
} from "./schemas";
import { notConfigured, readOledConfigFile } from "./config";
import { runOled, toFlagArgs } from "./exec";
import { parseNdjsonRows, parseSingle } from "./ndjson";
import { andThen, err, map, ok } from "./result";
import {
  accountMatchRowSchema,
  accountMatchSummarySchema,
  accountRowSchema,
  accountTreeNodeSchema,
  countSummarySchema,
  FILE_ID_PATTERN,
  ingestFileRowSchema,
  ingestFileSummarySchema,
  merchantRowSchema,
  pageSummarySchema,
  questionRowSchema,
  reportSchema,
  statusSchema,
  transactionRowSchema,
  treeSummarySchema,
} from "./schemas";

/**
 * Reads mask PII unless told otherwise. `report` is the one read that rejects
 * --no-redact outright (E_USAGE) — its output is currency totals with nothing
 * to mask — so the flag is applied per command, never blanket.
 */
const NO_REDACT = "--no-redact";

const PAGE_LIMIT = 500;
const MAX_ROWS = 10_000;

const DOCUMENT_FILE = "document.txt";

// Enough of a statement to read; a UI cannot render more, and the rest is one prepare away.
const MAX_DOCUMENT_CHARS = 1_000_000;

const PAGE_MARKER = /^--- page \d+ ---$/gm;

export interface TransactionFilters {
  account?: string;
  from?: string;
  to?: string;
  query?: string;
  currency?: string;
  limit?: number;
  offset?: number;
}

const TRANSACTION_FLAGS = {
  account: "--account",
  from: "--from",
  to: "--to",
  query: "--query",
  currency: "--currency",
  limit: "--limit",
  offset: "--offset",
} as const satisfies Record<keyof TransactionFilters, string>;

export interface ReportRange {
  from: string;
  to: string;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

const PAGE_FLAGS = {
  limit: "--limit",
  offset: "--offset",
} as const satisfies Record<keyof PageOptions, string>;

/** The extracted statement text, read from the cache `ingest prepare` wrote. */
export interface IngestDocument {
  file_id: string;
  path: string;
  text: string;
  /** The document outran the read cap, so `text` is its first page or pages. */
  truncated: boolean;
  page_count: number;
}

const errnoOf = (cause: unknown): unknown =>
  cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined;

/** ENOENT is the ordinary miss: nothing prepared the file, or closing it cleaned the cache. */
const readDocument = (
  path: string,
  fileId: string,
): Promise<Result<string, OledError>> =>
  readFile(path, "utf8").then(ok, (cause: unknown) =>
    err<OledError>(
      errnoOf(cause) === "ENOENT"
        ? {
            kind: "not_found",
            message: `No extracted document for ${fileId}`,
            hint: "run ingest prepare first",
          }
        : {
            kind: "cli_error",
            message: `Cannot read ${path}: ${String(cause)}`,
          },
    ),
  );

const admitStatus = (
  status: Status,
  configPath: string,
): Result<Status, OledError> => {
  // Gate first: a pre-contract CLI still falls back to the default profile,
  // and blaming the config would send the operator to reseed a healthy ledger.
  if (status.contract_version !== CONTRACT_VERSION) {
    const found = status.contract_version ?? "pre-0.24";
    const cli = status.version ?? "unknown version";
    return err<OledError>({
      kind: "contract_mismatch",
      message: `oled (${cli}) speaks wire contract ${String(found)}; this app expects ${String(CONTRACT_VERSION)}.`,
      hint: "Update the CLI (`npm install -g @aquartier/openledger`) or this app until the contract versions match.",
    });
  }

  // `contract_version` pins shape, not semantics: a same-contract CLI may
  // yet report `configured: false` instead of exiting 3 — refuse that answer.
  if (!status.configured) return err(notConfigured(configPath));
  return ok(status);
};

interface ReadsOptions {
  configPath: string;
  onCommand?: OledCommandListener;
}

export const createReads = ({ configPath, onCommand }: ReadsOptions) => {
  const exec = (args: string[]): Promise<Result<string, OledError>> =>
    runOled(args, { configPath, onCommand });

  /** Every list command ends the same way: rows, then one summary row. */
  const runList = async <TRow, TSummary>(
    args: string[],
    rowSchema: z.ZodType<TRow>,
    summarySchema: z.ZodType<TSummary>,
  ): Promise<Result<ListPage<TRow, TSummary>, OledError>> =>
    andThen(await exec(args), (stdout) =>
      parseNdjsonRows(rowSchema, stdout, summarySchema),
    );

  const status = async (): Promise<Result<Status, OledError>> => {
    const parsed = andThen(await exec(["status", NO_REDACT]), (stdout) =>
      parseSingle(statusSchema, stdout),
    );
    return andThen(parsed, (value) => admitStatus(value, configPath));
  };

  const report = async (
    range: ReportRange,
  ): Promise<Result<Report, OledError>> =>
    andThen(
      await exec(["report", "--from", range.from, "--to", range.to]),
      (stdout) => parseSingle(reportSchema, stdout),
    );

  const listTransactions = (
    filters: TransactionFilters = {},
  ): Promise<Result<ListPage<TransactionRow, PageSummary>, OledError>> =>
    runList(
      [
        "transactions",
        "list",
        ...toFlagArgs(TRANSACTION_FLAGS, filters),
        NO_REDACT,
      ],
      transactionRowSchema,
      pageSummarySchema,
    );

  const listAllTransactions = async (
    filters: Omit<TransactionFilters, "limit" | "offset"> = {},
  ): Promise<Result<TransactionRow[], OledError>> => {
    const rows: TransactionRow[] = [];
    let offset = 0;

    while (rows.length < MAX_ROWS) {
      const page = await listTransactions({
        ...filters,
        limit: PAGE_LIMIT,
        offset,
      });
      if (!page.ok) return page;

      rows.push(...page.value.rows);
      const { summary } = page.value;
      if (!summary?.has_more) break;
      // A page that advances nothing would spin forever.
      if (summary.returned <= 0) break;
      offset += summary.returned;
    }

    return ok(rows.slice(0, MAX_ROWS));
  };

  const listAccounts = (
    opts: { type?: AccountType } = {},
  ): Promise<Result<ListPage<AccountRow, CountSummary>, OledError>> =>
    runList(
      ["accounts", "list", ...toFlagArgs({ type: "--type" }, opts), NO_REDACT],
      accountRowSchema,
      countSummarySchema,
    );

  // `accounts match` declares no --no-redact; unknown flags exit 2 (E_USAGE).
  const matchAccounts = async (
    query: string,
  ): Promise<
    Result<ListPage<AccountMatchRow, AccountMatchSummary>, OledError>
  > => {
    if (query.trim() === "") {
      return err<OledError>({
        kind: "invalid",
        message: "accounts match: query cannot be empty",
      });
    }
    return runList(
      ["accounts", "match", "--query", query],
      accountMatchRowSchema,
      accountMatchSummarySchema,
    );
  };

  const accountsTree = (
    opts: { type?: AccountType } = {},
  ): Promise<Result<ListPage<AccountTreeNode, TreeSummary>, OledError>> =>
    runList(
      ["accounts", "tree", ...toFlagArgs({ type: "--type" }, opts), NO_REDACT],
      accountTreeNodeSchema,
      treeSummarySchema,
    );

  const listMerchants = (
    opts: PageOptions = {},
  ): Promise<Result<ListPage<MerchantRow, PageSummary>, OledError>> =>
    runList(
      ["merchants", "list", ...toFlagArgs(PAGE_FLAGS, opts), NO_REDACT],
      merchantRowSchema,
      pageSummarySchema,
    );

  const listQuestions = (
    opts: PageOptions & { includeDeferred?: boolean } = {},
  ): Promise<Result<ListPage<QuestionRow, PageSummary>, OledError>> =>
    runList(
      [
        "questions",
        "list",
        ...toFlagArgs(
          { ...PAGE_FLAGS, includeDeferred: "--include-deferred" },
          opts,
        ),
        NO_REDACT,
      ],
      questionRowSchema,
      pageSummarySchema,
    );

  // `ingest list` declares no --no-redact and rejects unknown flags with E_USAGE.
  const ingestList = (): Promise<
    Result<ListPage<IngestFileRow, IngestFileSummary>, OledError>
  > =>
    runList(["ingest", "list"], ingestFileRowSchema, ingestFileSummarySchema);

  /**
   * No command reads an extraction back, so this opens the artifact directly.
   * `ingest done` and `ingest fail` delete it with the rest of the file's cache.
   */
  const ingestDocument = async (
    fileId: string,
  ): Promise<Result<IngestDocument, OledError>> => {
    if (!FILE_ID_PATTERN.test(fileId)) {
      return err<OledError>({
        kind: "invalid",
        message: `Malformed file id: ${fileId}`,
        hint: "Pass the sf-<uuid> `ingest prepare` returned, not a path.",
      });
    }

    const config = await readOledConfigFile(configPath);
    if (!config.ok) return config;

    const path = join(config.value.cacheDir, fileId, DOCUMENT_FILE);
    return map(await readDocument(path, fileId), (text) => ({
      file_id: fileId,
      path,
      text: text.slice(0, MAX_DOCUMENT_CHARS),
      truncated: text.length > MAX_DOCUMENT_CHARS,
      // Counted over the whole document, so a truncated read still reports its length.
      page_count: text.match(PAGE_MARKER)?.length ?? 0,
    }));
  };

  const configDataDir = async (): Promise<Result<string, OledError>> =>
    map(await readOledConfigFile(configPath), (config) => config.dataDir);

  /**
   * Off the file, raw key included: this is a local single-user app and the
   * settings form shows what it will save. Writes still go through the CLI.
   */
  const configRead = (): Promise<Result<OledConfigFile, OledError>> =>
    readOledConfigFile(configPath);

  return {
    status,
    report,
    listTransactions,
    listAllTransactions,
    listAccounts,
    matchAccounts,
    accountsTree,
    listMerchants,
    listQuestions,
    ingestList,
    ingestDocument,
    configDataDir,
    configRead,
  };
};
