import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONTRACT_VERSION } from "@aquartier/openledger/contract";

import type { OledError } from "./errors";
import type { RunContext } from "./exec";
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
import { toFlagArgs } from "./argv";
import { notConfigured, readOledConfigFile } from "./config";
import { emptyInput, FILE_ID_HINT } from "./errors";
import { runList, runSingle } from "./exec";
import { FILE_ID_PATTERN } from "./ids";
import { andThen, err, map, messageOf, ok } from "./result";
import {
  accountMatchRowSchema,
  accountMatchSummarySchema,
  accountRowSchema,
  accountTreeNodeSchema,
  countSummarySchema,
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

// oled redacts PII by default; `report`, `accounts match` and `ingest list` reject this flag (E_USAGE).
const NO_REDACT = "--no-redact";

const PAGE_LIMIT = 500;
const MAX_ROWS = 10_000;

const DOCUMENT_FILE = "document.txt";

// Enough of a statement to read; a UI cannot render more, and the rest is one prepare away.
const MAX_DOCUMENT_CHARS = 1_000_000;

const PAGE_MARKER = /^--- page \d+ ---$/gm;

export interface PageOptions {
  limit?: number;
  offset?: number;
}

const PAGE_FLAGS = {
  limit: "--limit",
  offset: "--offset",
} as const satisfies Record<keyof PageOptions, string>;

export interface TransactionFilters extends PageOptions {
  account?: string;
  from?: string;
  to?: string;
  query?: string;
  currency?: string;
}

const TRANSACTION_FLAGS = {
  account: "--account",
  from: "--from",
  to: "--to",
  query: "--query",
  currency: "--currency",
  ...PAGE_FLAGS,
} as const satisfies Record<keyof TransactionFilters, string>;

export interface ReportRange {
  from: string;
  to: string;
}

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
            message: `Cannot read ${path}: ${messageOf(cause)}`,
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

export const createReads = (context: RunContext) => {
  const status = async (): Promise<Result<Status, OledError>> =>
    andThen(
      await runSingle(["status", NO_REDACT], statusSchema, context),
      (value) => admitStatus(value, context.configPath),
    );

  const report = (range: ReportRange): Promise<Result<Report, OledError>> =>
    runSingle(
      ["report", "--from", range.from, "--to", range.to],
      reportSchema,
      context,
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
      context,
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

  /** The rows one statement posted. The CLI has no file filter, so this scans. */
  const listTransactionsByFile = async (
    fileId: string,
  ): Promise<Result<TransactionRow[], OledError>> =>
    map(await listAllTransactions(), (rows) =>
      rows.filter((row) => row.source_file_id === fileId),
    );

  const listAccounts = (
    opts: { type?: AccountType } = {},
  ): Promise<Result<ListPage<AccountRow, CountSummary>, OledError>> =>
    runList(
      ["accounts", "list", ...toFlagArgs({ type: "--type" }, opts), NO_REDACT],
      accountRowSchema,
      countSummarySchema,
      context,
    );

  const matchAccounts = async (
    query: string,
  ): Promise<
    Result<ListPage<AccountMatchRow, AccountMatchSummary>, OledError>
  > => {
    if (query.trim() === "") return err(emptyInput("accounts match", "query"));
    return runList(
      ["accounts", "match", "--query", query],
      accountMatchRowSchema,
      accountMatchSummarySchema,
      context,
    );
  };

  const accountsTree = (
    opts: { type?: AccountType } = {},
  ): Promise<Result<ListPage<AccountTreeNode, TreeSummary>, OledError>> =>
    runList(
      ["accounts", "tree", ...toFlagArgs({ type: "--type" }, opts), NO_REDACT],
      accountTreeNodeSchema,
      treeSummarySchema,
      context,
    );

  const listMerchants = (
    opts: PageOptions = {},
  ): Promise<Result<ListPage<MerchantRow, PageSummary>, OledError>> =>
    runList(
      ["merchants", "list", ...toFlagArgs(PAGE_FLAGS, opts), NO_REDACT],
      merchantRowSchema,
      pageSummarySchema,
      context,
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
      context,
    );

  const ingestList = (): Promise<
    Result<ListPage<IngestFileRow, IngestFileSummary>, OledError>
  > =>
    runList(
      ["ingest", "list"],
      ingestFileRowSchema,
      ingestFileSummarySchema,
      context,
    );

  /** No command reads an extraction back, so this opens the cached artifact directly. */
  const ingestDocument = async (
    fileId: string,
  ): Promise<Result<IngestDocument, OledError>> => {
    if (!FILE_ID_PATTERN.test(fileId)) {
      return err<OledError>({
        kind: "invalid",
        message: `Malformed file id: ${fileId}`,
        hint: FILE_ID_HINT,
      });
    }

    const config = await readOledConfigFile(context.configPath);
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
    map(
      await readOledConfigFile(context.configPath),
      (config) => config.dataDir,
    );

  return {
    status,
    report,
    listTransactions,
    listAllTransactions,
    listTransactionsByFile,
    listAccounts,
    matchAccounts,
    accountsTree,
    listMerchants,
    listQuestions,
    ingestList,
    ingestDocument,
    configDataDir,
  };
};
