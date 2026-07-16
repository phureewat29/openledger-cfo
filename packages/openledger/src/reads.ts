import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { OledError } from "./errors";
import type { OledCommandListener } from "./exec";
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
import { readOledConfigFile } from "./config";
import { runOled } from "./exec";
import { parseNdjsonRows, parseSingle } from "./ndjson";
import { err, ok } from "./result";
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

const TRANSACTION_FLAGS: Record<keyof TransactionFilters, string> = {
  account: "--account",
  from: "--from",
  to: "--to",
  query: "--query",
  currency: "--currency",
  limit: "--limit",
  offset: "--offset",
};

const toTransactionArgs = (filters: TransactionFilters): string[] =>
  Object.entries(TRANSACTION_FLAGS).flatMap(([key, flag]) => {
    const value = filters[key as keyof TransactionFilters];
    if (value === undefined) return [];
    return [flag, String(value)];
  });

export interface ListPage<TRow, TSummary> {
  rows: TRow[];
  summary: TSummary | undefined;
}

export interface ReportRange {
  from: string;
  to: string;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

const toPageArgs = ({ limit, offset }: PageOptions): string[] => [
  ...(limit === undefined ? [] : ["--limit", String(limit)]),
  ...(offset === undefined ? [] : ["--offset", String(offset)]),
];

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
const readDocument = async (
  path: string,
  fileId: string,
): Promise<Result<string, OledError>> => {
  try {
    return ok(await readFile(path, "utf8"));
  } catch (cause) {
    if (errnoOf(cause) === "ENOENT") {
      return err<OledError>({
        kind: "not_found",
        message: `No extracted document for ${fileId}`,
        hint: "run ingest prepare first",
      });
    }
    return err<OledError>({
      kind: "cli_error",
      message: `Cannot read ${path}: ${String(cause)}`,
    });
  }
};

export interface ReadsOptions {
  configPath: string;
  onCommand?: OledCommandListener;
}

export const createReads = ({ configPath, onCommand }: ReadsOptions) => {
  const exec = (args: string[]): Promise<Result<string, OledError>> =>
    runOled(args, { configPath, onCommand });

  const status = async (): Promise<Result<Status, OledError>> => {
    const out = await exec(["status", NO_REDACT]);
    if (!out.ok) return out;

    const parsed = parseSingle(statusSchema, out.value);
    if (!parsed.ok) return parsed;

    // `status` is the only command that survives a missing config: it exits 0
    // and silently reports the default ~/.oled ledger. Refuse that answer.
    if (!parsed.value.configured) {
      return err<OledError>({
        kind: "not_configured",
        message: `No oled config at ${configPath}`,
        hint: "Run `oled config <path> --init`, or point OLED_CONFIG at an initialized ledger.",
      });
    }
    return parsed;
  };

  const report = async (
    range: ReportRange,
  ): Promise<Result<Report, OledError>> => {
    const out = await exec(["report", "--from", range.from, "--to", range.to]);
    if (!out.ok) return out;
    return parseSingle(reportSchema, out.value);
  };

  const listTransactions = async (
    filters: TransactionFilters = {},
  ): Promise<Result<ListPage<TransactionRow, PageSummary>, OledError>> => {
    const out = await exec([
      "transactions",
      "list",
      ...toTransactionArgs(filters),
      NO_REDACT,
    ]);
    if (!out.ok) return out;
    return parseNdjsonRows(transactionRowSchema, out.value, pageSummarySchema);
  };

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

  const listAccounts = async (
    opts: { type?: AccountType } = {},
  ): Promise<Result<ListPage<AccountRow, CountSummary>, OledError>> => {
    const out = await exec([
      "accounts",
      "list",
      ...(opts.type === undefined ? [] : ["--type", opts.type]),
      NO_REDACT,
    ]);
    if (!out.ok) return out;
    return parseNdjsonRows(accountRowSchema, out.value, countSummarySchema);
  };

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

    const out = await exec(["accounts", "match", "--query", query]);
    if (!out.ok) return out;
    return parseNdjsonRows(
      accountMatchRowSchema,
      out.value,
      accountMatchSummarySchema,
    );
  };

  const accountsTree = async (
    opts: { type?: AccountType } = {},
  ): Promise<Result<ListPage<AccountTreeNode, TreeSummary>, OledError>> => {
    const out = await exec([
      "accounts",
      "tree",
      ...(opts.type === undefined ? [] : ["--type", opts.type]),
      NO_REDACT,
    ]);
    if (!out.ok) return out;
    return parseNdjsonRows(accountTreeNodeSchema, out.value, treeSummarySchema);
  };

  const listMerchants = async (
    opts: PageOptions = {},
  ): Promise<Result<ListPage<MerchantRow, PageSummary>, OledError>> => {
    const out = await exec([
      "merchants",
      "list",
      ...toPageArgs(opts),
      NO_REDACT,
    ]);
    if (!out.ok) return out;
    return parseNdjsonRows(merchantRowSchema, out.value, pageSummarySchema);
  };

  const listQuestions = async (
    opts: PageOptions & { includeDeferred?: boolean } = {},
  ): Promise<Result<ListPage<QuestionRow, PageSummary>, OledError>> => {
    const out = await exec([
      "questions",
      "list",
      ...toPageArgs(opts),
      ...(opts.includeDeferred === true ? ["--include-deferred"] : []),
      NO_REDACT,
    ]);
    if (!out.ok) return out;
    return parseNdjsonRows(questionRowSchema, out.value, pageSummarySchema);
  };

  // `ingest list` declares no --no-redact and rejects unknown flags with E_USAGE.
  const ingestList = async (): Promise<
    Result<ListPage<IngestFileRow, IngestFileSummary>, OledError>
  > => {
    const out = await exec(["ingest", "list"]);
    if (!out.ok) return out;
    return parseNdjsonRows(
      ingestFileRowSchema,
      out.value,
      ingestFileSummarySchema,
    );
  };

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
    const read = await readDocument(path, fileId);
    if (!read.ok) return read;
    const text = read.value;

    return ok({
      file_id: fileId,
      path,
      text: text.slice(0, MAX_DOCUMENT_CHARS),
      truncated: text.length > MAX_DOCUMENT_CHARS,
      // Counted over the whole document, so a truncated read still reports its length.
      page_count: text.match(PAGE_MARKER)?.length ?? 0,
    });
  };

  const configDataDir = async (): Promise<Result<string, OledError>> => {
    const config = await readOledConfigFile(configPath);
    if (!config.ok) return config;
    return ok(config.value.dataDir);
  };

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
  };
};
