import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partition } from "es-toolkit";
import { z } from "zod/v4";

import type { OledError } from "./errors";
import type { OledCommandListener, OledLane } from "./exec";
import type { Result } from "./result";
import type {
  AccountAdjustResult,
  AccountCreatedResult,
  AccountCreateInput,
  AccountCreateResult,
  AccountCreateSummary,
  AccountDeleteResult,
  AccountMergeResult,
  AccountUpdateInput,
  AccountUpdateResult,
  ConfigInitInput,
  ConfigInitResult,
  FileDropResult,
  IngestDoneResult,
  IngestFailResult,
  IngestResult,
  IngestRowInput,
  IngestSummary,
  MerchantUpsertInput,
  MerchantUpsertResult,
  PrepareResult,
  QuestionAnswerRow,
  QuestionDeferRow,
  RecategorizeResult,
  TransactionAddInput,
  TransactionAddResult,
  TransactionDeleteResult,
  TransactionMergeResult,
  TransactionUpdateInput,
  TransactionUpdateResult,
} from "./schemas";
import { formatOledCommand, runOled, runOledConfig } from "./exec";
import { parseNdjsonRows, parseSingle } from "./ndjson";
import { err, ok } from "./result";
import {
  accountAdjustResultSchema,
  accountCreatedResultSchema,
  accountCreateInputSchema,
  accountCreateResultSchema,
  accountCreateSummarySchema,
  accountDeleteResultSchema,
  accountIdSchema,
  accountMergeResultSchema,
  accountUpdateInputSchema,
  accountUpdateResultSchema,
  configInitInputSchema,
  configInitResultSchema,
  FILE_ID_PATTERN,
  fileDropResultSchema,
  ingestDoneResultSchema,
  ingestFailResultSchema,
  ingestResultSchema,
  ingestRowInputSchema,
  ingestSummarySchema,
  merchantUpsertInputSchema,
  merchantUpsertResultSchema,
  prepareResultSchema,
  questionAnswerRowSchema,
  questionDeferRowSchema,
  recategorizeResultSchema,
  transactionAddInputSchema,
  transactionAddResultSchema,
  transactionDeleteResultSchema,
  transactionMergeResultSchema,
  transactionUpdateInputSchema,
  transactionUpdateResultSchema,
} from "./schemas";

const toInvalidInput = (error: z.ZodError, label: string): OledError => ({
  kind: "invalid",
  message: `${label}: ${z.prettifyError(error)}`,
});

const malformedFileId = (label: string, fileId: string): OledError => ({
  kind: "invalid",
  message: `${label}: malformed file id "${fileId}"`,
  hint: "Pass the sf-<uuid> `ingest prepare` returned, not a path.",
});

// An empty positional would leave the CLI reading the next flag as the id.
const emptyInput = (label: string, what: string): OledError => ({
  kind: "invalid",
  message: `${label}: ${what} cannot be empty`,
});

const toNdjson = (rows: unknown[]): string =>
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

export interface BatchOutcome<TRow, TSummary> {
  rows: TRow[];
  summary: TSummary;
}

/** What ran, ready to show: the full argv with any password already masked. */
export type WithCommand<T> = T & { command: string };

/**
 * Batch commands exit 7 and keep the successful rows when some rows fail, so a
 * partial batch surfaces as an error carrying the failed rows rather than as a
 * silent success.
 */
const toBatchOutcome = <
  TRow extends { ok: boolean },
  TSummary extends { failed: number },
>(
  page: { rows: TRow[]; summary: TSummary | undefined },
  label: string,
): Result<BatchOutcome<TRow, TSummary>, OledError> => {
  const { rows, summary } = page;
  if (!summary) {
    return err<OledError>({
      kind: "parse_failed",
      message: `${label}: batch summary row missing`,
    });
  }

  const [failed] = partition(rows, (row) => !row.ok);
  if (summary.failed > 0 || failed.length > 0) {
    return err<OledError>({
      kind: "partial",
      message: `${label}: ${String(summary.failed)} of ${String(rows.length)} rows failed`,
      exitCode: 7,
      failures: failed,
    });
  }

  return ok({ rows, summary });
};

const CONFIG_FLAGS = {
  db: "--db",
  dataDir: "--data-dir",
  cacheDir: "--cache-dir",
  country: "--country",
  currency: "--currency",
  locale: "--locale",
  userName: "--user-name",
  ocrBaseUrl: "--ocr-base-url",
  ocrModel: "--ocr-model",
} as const;

const MERCHANT_FLAGS = {
  name: "--name",
  alias: "--alias",
  default_account: "--default-account",
} as const;

const TRANSACTION_ADD_FLAGS = {
  debit_account: "--debit-account",
  credit_account: "--credit-account",
  amount: "--amount",
  date: "--date",
  description: "--description",
  merchant_name: "--merchant-name",
} as const;

const ACCOUNT_CREATE_FLAGS = {
  id: "--id",
  name: "--name",
  type: "--type",
  parent_id: "--parent",
  subtype: "--subtype",
  bank_name: "--bank",
  account_number_masked: "--masked",
  due_day: "--due-day",
  statement_day: "--statement-day",
} as const;

const ACCOUNT_UPDATE_FLAGS = {
  name: "--name",
  due_day: "--due-day",
  statement_day: "--statement-day",
  points: "--points",
  bank_name: "--bank",
  account_number_masked: "--masked",
} as const;

const TRANSACTION_UPDATE_FLAGS = {
  date: "--date",
  description: "--description",
  merchant: "--merchant",
} as const;

/** Flag tables carry the knowledge; this walks any of them over an input. */
const toFlagArgs = <TInput extends object>(
  flags: Partial<Record<keyof TInput & string, string>>,
  input: TInput,
): string[] =>
  Object.entries(flags).flatMap(([key, flag]) => {
    const value = input[key as keyof TInput];
    return value === undefined ? [] : [flag as string, String(value)];
  });

/** Both sides of a move or merge must name the same ledger. */
const accountPairSchema = z
  .object({ from: accountIdSchema, to: accountIdSchema })
  .refine((pair) => pair.from !== pair.to, {
    message: "from and to are the same account",
  })
  .refine((pair) => pair.from.slice(0, 3) === pair.to.slice(0, 3), {
    message: "accounts are on different currency ledgers",
  });

export interface IngestPrepareOptions {
  /** Only a locked PDF needs one; it never reaches an event, a log or an error. */
  password?: string;
  /** Ignore the text layer and read the page images instead. */
  rescan?: boolean;
  /** Re-register the file, dropping the prior ingest's rows and artifacts. */
  force?: boolean;
}

export interface IngestDoneOptions {
  account?: string;
  closingBalance?: number;
}

export interface WritesOptions {
  configPath: string;
  onCommand?: OledCommandListener;
}

export const createWrites = ({ configPath, onCommand }: WritesOptions) => {
  const exec = (
    args: string[],
    opts: { stdin?: string; allowPartial?: boolean; lane?: OledLane } = {},
  ): Promise<Result<string, OledError>> =>
    runOled(args, { configPath, onCommand, ...opts });

  const toCommand = (args: string[]): string =>
    formatOledCommand(args, configPath);

  /** The shared tail of every single-row command: run, parse, stamp the command. */
  const runSingle = async <T extends object>(
    args: string[],
    schema: Parameters<typeof parseSingle<T>>[0],
    opts: { stdin?: string; allowPartial?: boolean; lane?: OledLane } = {},
  ): Promise<Result<WithCommand<T>, OledError>> => {
    const out = await exec(args, opts);
    if (!out.ok) return out;

    const parsed = parseSingle(schema, out.value);
    if (!parsed.ok) return parsed;
    return ok({ ...parsed.value, command: toCommand(args) });
  };

  /**
   * Initializes a brand-new ledger. The target config path is a positional
   * argument here, so this is the one method that ignores the instance's
   * configPath, and --init refuses a config file that already exists.
   */
  const configInit = async (
    input: ConfigInitInput,
  ): Promise<Result<ConfigInitResult, OledError>> => {
    const validated = configInitInputSchema.safeParse(input);
    if (!validated.success)
      return err(toInvalidInput(validated.error, "config init"));

    const out = await runOledConfig(
      [
        "config",
        validated.data.configPath,
        "--init",
        ...toFlagArgs(CONFIG_FLAGS, validated.data),
      ],
      { onCommand },
    );
    if (!out.ok) return out;
    return parseSingle(configInitResultSchema, out.value);
  };

  const accountsCreateBatch = async (
    rows: AccountCreateInput[],
  ): Promise<
    Result<BatchOutcome<AccountCreateResult, AccountCreateSummary>, OledError>
  > => {
    const validated = z.array(accountCreateInputSchema).min(1).safeParse(rows);
    if (!validated.success) {
      return err(toInvalidInput(validated.error, "accounts create"));
    }

    // The batch form reads a file path; unlike `ingest commit` it has no stdin mode.
    const file = join(tmpdir(), `oled-accounts-${randomUUID()}.ndjson`);
    try {
      await writeFile(file, toNdjson(validated.data), "utf8");
    } catch (cause) {
      return err<OledError>({
        kind: "cli_error",
        message: `accounts create: could not stage ${file}: ${String(cause)}`,
      });
    }

    try {
      const out = await exec(["accounts", "create", "--input", file], {
        allowPartial: true,
      });
      if (!out.ok) return out;

      const page = parseNdjsonRows(
        accountCreateResultSchema,
        out.value,
        accountCreateSummarySchema,
      );
      if (!page.ok) return page;
      return toBatchOutcome(page.value, "accounts create");
    } finally {
      await rm(file, { force: true });
    }
  };

  const merchantsUpsert = async (
    input: MerchantUpsertInput,
  ): Promise<Result<MerchantUpsertResult, OledError>> => {
    const validated = merchantUpsertInputSchema.safeParse(input);
    if (!validated.success) {
      return err(toInvalidInput(validated.error, "merchants upsert"));
    }

    const out = await exec([
      "merchants",
      "upsert",
      ...toFlagArgs(MERCHANT_FLAGS, validated.data),
    ]);
    if (!out.ok) return out;
    return parseSingle(merchantUpsertResultSchema, out.value);
  };

  /**
   * Reads one statement into text or page images. Runs on the slow lane: OCR
   * holds the file for minutes and every other command has to stay answerable.
   */
  const ingestPrepare = async (
    pathOrId: string,
    opts: IngestPrepareOptions = {},
  ): Promise<Result<WithCommand<PrepareResult>, OledError>> => {
    if (pathOrId.trim() === "") {
      return err(emptyInput("ingest prepare", "path or file id"));
    }

    const args = [
      "ingest",
      "prepare",
      pathOrId,
      ...(opts.password === undefined ? [] : ["--password", opts.password]),
      ...(opts.rescan === true ? ["--rescan"] : []),
      ...(opts.force === true ? ["--force"] : []),
    ];

    // Exit 7 is a document with holes, not a failed read: failed_pages names them.
    return runSingle(args, prepareResultSchema, {
      lane: "slow",
      allowPartial: true,
    });
  };

  const ingestCommit = async (
    rows: IngestRowInput[],
    opts: { fileId?: string } = {},
  ): Promise<
    Result<WithCommand<BatchOutcome<IngestResult, IngestSummary>>, OledError>
  > => {
    const validated = z.array(ingestRowInputSchema).min(1).safeParse(rows);
    if (!validated.success)
      return err(toInvalidInput(validated.error, "ingest commit"));
    if (opts.fileId !== undefined && !FILE_ID_PATTERN.test(opts.fileId)) {
      return err(malformedFileId("ingest commit", opts.fileId));
    }

    const args = [
      "ingest",
      "commit",
      ...(opts.fileId === undefined ? [] : ["--file", opts.fileId]),
    ];

    const out = await exec(args, {
      stdin: toNdjson(validated.data),
      allowPartial: true,
    });
    if (!out.ok) return out;

    const page = parseNdjsonRows(
      ingestResultSchema,
      out.value,
      ingestSummarySchema,
    );
    if (!page.ok) return page;

    const outcome = toBatchOutcome(page.value, "ingest commit");
    if (!outcome.ok) return outcome;
    return ok({ ...outcome.value, command: toCommand(args) });
  };

  const ingestDone = async (
    fileId: string,
    opts: IngestDoneOptions = {},
  ): Promise<Result<WithCommand<IngestDoneResult>, OledError>> => {
    if (!FILE_ID_PATTERN.test(fileId)) {
      return err(malformedFileId("ingest done", fileId));
    }
    // The ledger reconciles against the pair or not at all; half of it is a usage error.
    if ((opts.account === undefined) !== (opts.closingBalance === undefined)) {
      return err<OledError>({
        kind: "invalid",
        message: "ingest done: account and closingBalance go together",
      });
    }

    const args = [
      "ingest",
      "done",
      fileId,
      ...(opts.account === undefined ? [] : ["--account", opts.account]),
      ...(opts.closingBalance === undefined
        ? []
        : ["--closing-balance", String(opts.closingBalance)]),
    ];

    return runSingle(args, ingestDoneResultSchema);
  };

  const ingestFail = async (
    fileId: string,
    note: string,
  ): Promise<Result<WithCommand<IngestFailResult>, OledError>> => {
    if (!FILE_ID_PATTERN.test(fileId)) {
      return err(malformedFileId("ingest fail", fileId));
    }
    if (note.trim() === "") {
      return err(emptyInput("ingest fail", "failure note"));
    }

    const args = ["ingest", "fail", fileId, "--error", note];
    return runSingle(args, ingestFailResultSchema);
  };

  /**
   * Deregisters a file: the only command that undoes a registration. It
   * cascades the file's transactions and questions, purges its cache, and
   * reads nothing off disk, so a statement the operator already deleted can
   * still be taken off the ledger's books.
   */
  const filesDrop = async (
    fileId: string,
  ): Promise<Result<WithCommand<FileDropResult>, OledError>> => {
    if (!FILE_ID_PATTERN.test(fileId)) {
      return err(malformedFileId("files drop", fileId));
    }

    const args = ["files", "drop", fileId, "--yes"];
    return runSingle(args, fileDropResultSchema);
  };

  /** `also` closes sibling questions in the same call; every id must exist or none close. */
  const questionAnswer = async (
    id: string,
    response: string,
    opts: { also?: string[] } = {},
  ): Promise<Result<WithCommand<{ rows: QuestionAnswerRow[] }>, OledError>> => {
    const also = opts.also ?? [];
    if (id.trim() === "") return err(emptyInput("questions answer", "id"));
    if (response.trim() === "") {
      return err(emptyInput("questions answer", "answer"));
    }
    // --also travels as one comma-separated list, so a comma inside an id splits it.
    if ([id, ...also].some((value) => value.includes(","))) {
      return err<OledError>({
        kind: "invalid",
        message: "questions answer: a question id cannot contain a comma",
      });
    }

    const args = [
      "questions",
      "answer",
      id,
      "--answer",
      response,
      ...(also.length === 0 ? [] : ["--also", also.join(",")]),
    ];

    const out = await exec(args);
    if (!out.ok) return out;

    // One row per closed question, and no summary line to end them.
    const page = parseNdjsonRows(questionAnswerRowSchema, out.value);
    if (!page.ok) return page;
    return ok({ rows: page.value.rows, command: toCommand(args) });
  };

  const questionDefer = async (
    id: string,
    opts: { days?: number } = {},
  ): Promise<Result<WithCommand<QuestionDeferRow>, OledError>> => {
    if (id.trim() === "") return err(emptyInput("questions defer", "id"));

    const args = [
      "questions",
      "defer",
      id,
      ...(opts.days === undefined ? [] : ["--days", String(opts.days)]),
    ];

    return runSingle(args, questionDeferRowSchema);
  };

  const transactionAdd = async (
    input: TransactionAddInput,
  ): Promise<Result<WithCommand<TransactionAddResult>, OledError>> => {
    const validated = transactionAddInputSchema.safeParse(input);
    if (!validated.success) {
      return err(toInvalidInput(validated.error, "transactions add"));
    }

    const args = [
      "transactions",
      "add",
      ...toFlagArgs(TRANSACTION_ADD_FLAGS, validated.data),
      ...(validated.data.resolve === true ? ["--resolve"] : []),
    ];
    return runSingle(args, transactionAddResultSchema);
  };

  const transactionUpdate = async (
    id: string,
    patch: TransactionUpdateInput,
  ): Promise<Result<WithCommand<TransactionUpdateResult>, OledError>> => {
    if (id.trim() === "") {
      return err(emptyInput("transactions update", "transaction id"));
    }
    const validated = transactionUpdateInputSchema.safeParse(patch);
    if (!validated.success) {
      return err(toInvalidInput(validated.error, "transactions update"));
    }

    const args = [
      "transactions",
      "update",
      id,
      ...toFlagArgs(TRANSACTION_UPDATE_FLAGS, validated.data),
    ];
    return runSingle(args, transactionUpdateResultSchema);
  };

  const transactionDelete = async (
    id: string,
  ): Promise<Result<WithCommand<TransactionDeleteResult>, OledError>> => {
    if (id.trim() === "") {
      return err(emptyInput("transactions delete", "transaction id"));
    }

    const args = ["transactions", "delete", id, "--yes"];
    return runSingle(args, transactionDeleteResultSchema);
  };

  /** Re-points one account's ENTIRE history; there is no narrower filter. */
  const transactionsRecategorize = async (input: {
    from: string;
    to: string;
  }): Promise<Result<WithCommand<RecategorizeResult>, OledError>> => {
    const validated = accountPairSchema.safeParse(input);
    if (!validated.success) {
      return err(toInvalidInput(validated.error, "transactions recategorize"));
    }

    const args = [
      "transactions",
      "recategorize",
      "--filter-account",
      validated.data.from,
      "--set-account",
      validated.data.to,
    ];
    return runSingle(args, recategorizeResultSchema);
  };

  const transactionsMerge = async (input: {
    from: string;
    to: string;
  }): Promise<Result<WithCommand<TransactionMergeResult>, OledError>> => {
    if (input.from.trim() === "" || input.to.trim() === "") {
      return err(emptyInput("transactions merge", "transaction id"));
    }
    if (input.from === input.to) {
      return err<OledError>({
        kind: "invalid",
        message: "transactions merge: from and to are the same transaction",
      });
    }

    const args = [
      "transactions",
      "merge",
      "--from",
      input.from,
      "--to",
      input.to,
      "--yes",
    ];
    return runSingle(args, transactionMergeResultSchema);
  };

  const accountsCreate = async (
    input: AccountCreateInput,
  ): Promise<Result<WithCommand<AccountCreatedResult>, OledError>> => {
    const validated = accountCreateInputSchema.safeParse(input);
    if (!validated.success) {
      return err(toInvalidInput(validated.error, "accounts create"));
    }

    const args = [
      "accounts",
      "create",
      ...toFlagArgs(ACCOUNT_CREATE_FLAGS, validated.data),
      ...(validated.data.metadata === undefined
        ? []
        : ["--metadata", JSON.stringify(validated.data.metadata)]),
    ];
    return runSingle(args, accountCreatedResultSchema);
  };

  const accountsUpdate = async (
    id: string,
    patch: AccountUpdateInput,
  ): Promise<Result<WithCommand<AccountUpdateResult>, OledError>> => {
    if (id.trim() === "") {
      return err(emptyInput("accounts update", "account id"));
    }
    const validated = accountUpdateInputSchema.safeParse(patch);
    if (!validated.success) {
      return err(toInvalidInput(validated.error, "accounts update"));
    }

    const args = [
      "accounts",
      "update",
      id,
      ...toFlagArgs(ACCOUNT_UPDATE_FLAGS, validated.data),
      ...(validated.data.metadata === undefined
        ? []
        : ["--metadata", JSON.stringify(validated.data.metadata)]),
    ];
    return runSingle(args, accountUpdateResultSchema);
  };

  const accountsMerge = async (input: {
    from: string;
    to: string;
  }): Promise<Result<WithCommand<AccountMergeResult>, OledError>> => {
    const validated = accountPairSchema.safeParse(input);
    if (!validated.success) {
      return err(toInvalidInput(validated.error, "accounts merge"));
    }

    const args = [
      "accounts",
      "merge",
      "--from",
      validated.data.from,
      "--to",
      validated.data.to,
      "--yes",
    ];
    return runSingle(args, accountMergeResultSchema);
  };

  const accountsAdjust = async (
    id: string,
    opts: { to: number; reason: string; date?: string },
  ): Promise<Result<WithCommand<AccountAdjustResult>, OledError>> => {
    if (id.trim() === "") {
      return err(emptyInput("accounts adjust", "account id"));
    }
    // A correction with no why is unreadable in next month's statement view.
    if (opts.reason.trim() === "") {
      return err(emptyInput("accounts adjust", "reason"));
    }
    if (!Number.isFinite(opts.to)) {
      return err<OledError>({
        kind: "invalid",
        message: "accounts adjust: target balance must be a finite number",
      });
    }

    const args = [
      "accounts",
      "adjust",
      id,
      "--to",
      String(opts.to),
      "--reason",
      opts.reason,
      ...(opts.date === undefined ? [] : ["--date", opts.date]),
    ];
    return runSingle(args, accountAdjustResultSchema);
  };

  const accountsDelete = async (
    id: string,
  ): Promise<Result<WithCommand<AccountDeleteResult>, OledError>> => {
    if (id.trim() === "") {
      return err(emptyInput("accounts delete", "account id"));
    }

    const args = ["accounts", "delete", id, "--yes"];
    return runSingle(args, accountDeleteResultSchema);
  };

  return {
    configInit,
    accountsCreateBatch,
    accountsCreate,
    accountsUpdate,
    accountsMerge,
    accountsAdjust,
    accountsDelete,
    merchantsUpsert,
    ingestPrepare,
    ingestCommit,
    ingestDone,
    ingestFail,
    filesDrop,
    questionAnswer,
    questionDefer,
    transactionAdd,
    transactionUpdate,
    transactionDelete,
    transactionsRecategorize,
    transactionsMerge,
  };
};
