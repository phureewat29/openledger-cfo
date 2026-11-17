import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT, QuestionsAnswerSummary } from "@aquartier/openledger/contract";
import { attemptAsync } from "es-toolkit";
import { z } from "zod/v4";

import type { OledError } from "./errors";
import type { OledCommandListener, OledLane } from "./exec";
import type { ListPage } from "./ndjson";
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
  ConfigSetInput,
  ConfigView,
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
import { parseAs } from "./errors";
import { formatOledCommand, runOled, runOledConfig, toFlagArgs } from "./exec";
import { parseNdjsonRows, parseSingle } from "./ndjson";
import { andThen, err, map, messageOf, ok } from "./result";
import {
  accountAdjustResultSchema,
  accountCreatedResultSchema,
  accountCreateInputSchema,
  accountCreateResultSchema,
  accountCreateSummarySchema,
  accountDeleteResultSchema,
  accountMergeResultSchema,
  accountPairSchema,
  accountUpdateInputSchema,
  accountUpdateResultSchema,
  configInitInputSchema,
  configInitResultSchema,
  configSetInputSchema,
  configViewSchema,
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

const validate = <T>(
  schema: z.ZodType<T>,
  input: unknown,
  label: string,
): Result<T, OledError> => parseAs(schema, input, "invalid", label);

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
 * Batch commands exit 7 and keep the successful rows when some fail, so a
 * partial batch surfaces as an error carrying the failed rows, not a silent success.
 */
const toBatchOutcome = <
  TRow extends { ok: boolean },
  TSummary extends { failed: number },
>(
  { rows, summary }: ListPage<TRow, TSummary>,
  label: string,
): Result<BatchOutcome<TRow, TSummary>, OledError> => {
  if (!summary) {
    return err<OledError>({
      kind: "parse_failed",
      message: `${label}: batch summary row missing`,
    });
  }

  const failed = rows.filter((row) => !row.ok);
  if (summary.failed > 0 || failed.length > 0) {
    return err<OledError>({
      kind: "partial",
      message: `${label}: ${String(summary.failed)} of ${String(rows.length)} rows failed`,
      exitCode: EXIT.PARTIAL,
      failures: failed,
    });
  }

  return ok({ rows, summary });
};

const CONFIG_SET_FLAGS = {
  ocrBaseUrl: "--ocr-base-url",
  ocrModel: "--ocr-model",
  ocrApiKey: "--ocr-api-key",
} as const satisfies Partial<Record<keyof ConfigSetInput, string>>;

const CONFIG_FLAGS = {
  db: "--db",
  dataDir: "--data-dir",
  cacheDir: "--cache-dir",
  country: "--country",
  currency: "--currency",
  locale: "--locale",
  userName: "--user-name",
  ...CONFIG_SET_FLAGS,
} as const satisfies Partial<Record<keyof ConfigInitInput, string>>;

const MERCHANT_FLAGS = {
  name: "--name",
  alias: "--alias",
  default_account: "--default-account",
} as const satisfies Partial<Record<keyof MerchantUpsertInput, string>>;

const TRANSACTION_ADD_FLAGS = {
  debit_account: "--debit-account",
  credit_account: "--credit-account",
  amount: "--amount",
  date: "--date",
  description: "--description",
  merchant_name: "--merchant-name",
  resolve: "--resolve",
} as const satisfies Partial<Record<keyof TransactionAddInput, string>>;

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
  metadata: "--metadata",
} as const satisfies Partial<Record<keyof AccountCreateInput, string>>;

const ACCOUNT_UPDATE_FLAGS = {
  name: "--name",
  due_day: "--due-day",
  statement_day: "--statement-day",
  points: "--points",
  bank_name: "--bank",
  account_number_masked: "--masked",
  metadata: "--metadata",
} as const satisfies Partial<Record<keyof AccountUpdateInput, string>>;

const TRANSACTION_UPDATE_FLAGS = {
  date: "--date",
  description: "--description",
  merchant: "--merchant",
} as const satisfies Partial<Record<keyof TransactionUpdateInput, string>>;

export interface IngestPrepareOptions {
  /** Only a locked PDF needs one; it never reaches an event, a log or an error. */
  password?: string;
  /** Ignore the text layer and read every page with the built-in OCR. */
  rescan?: boolean;
  /** Re-register the file, dropping the prior ingest's rows and artifacts. */
  force?: boolean;
}

const PREPARE_FLAGS = {
  password: "--password",
  rescan: "--rescan",
  force: "--force",
} as const satisfies Record<keyof IngestPrepareOptions, string>;

export interface IngestDoneOptions {
  account?: string;
  closingBalance?: number;
}

const DONE_FLAGS = {
  account: "--account",
  closingBalance: "--closing-balance",
} as const satisfies Record<keyof IngestDoneOptions, string>;

interface WritesOptions {
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
    schema: z.ZodType<T>,
    opts: Parameters<typeof exec>[1] = {},
  ): Promise<Result<WithCommand<T>, OledError>> => {
    const parsed = andThen(await exec(args, opts), (stdout) =>
      parseSingle(schema, stdout),
    );
    return map(parsed, (value) => ({ ...value, command: toCommand(args) }));
  };

  /**
   * Initializes a brand-new ledger. The target config path is a positional
   * argument here, so this is the one method that ignores the instance's
   * configPath, and --init refuses a config file that already exists.
   */
  const configInit = async (
    input: ConfigInitInput,
  ): Promise<Result<ConfigInitResult, OledError>> => {
    const validated = validate(configInitInputSchema, input, "config init");
    if (!validated.ok) return validated;

    const out = await runOledConfig(
      [
        "config",
        validated.value.configPath,
        "--init",
        ...toFlagArgs(CONFIG_FLAGS, validated.value),
      ],
      { onCommand },
    );
    return andThen(out, (stdout) =>
      parseSingle(configInitResultSchema, stdout),
    );
  };

  /**
   * Changes settings on an existing ledger: `oled config` without `--init` is
   * a partial upsert, so unnamed keys survive. The existence guard is
   * load-bearing — a setting flag creates the file on first touch, and a bare
   * config born that way makes a later `configInit --init` refuse (exit 6).
   */
  const configSet = async (
    input: ConfigSetInput,
  ): Promise<Result<ConfigView, OledError>> => {
    const validated = validate(configSetInputSchema, input, "config set");
    if (!validated.ok) return validated;

    const flags = toFlagArgs(CONFIG_SET_FLAGS, validated.value);
    if (flags.length === 0) {
      return err<OledError>({
        kind: "invalid",
        message: "config set: nothing to set",
      });
    }
    if (!existsSync(configPath)) {
      return err<OledError>({
        kind: "not_configured",
        message: `No oled config at ${configPath}`,
        hint: "Initialize the ledger first: `oled config <path> --init`.",
      });
    }

    const out = await runOledConfig(["config", configPath, ...flags], {
      onCommand,
    });
    return andThen(out, (stdout) => parseSingle(configViewSchema, stdout));
  };

  const accountsCreateBatch = async (
    rows: AccountCreateInput[],
  ): Promise<
    Result<BatchOutcome<AccountCreateResult, AccountCreateSummary>, OledError>
  > => {
    const validated = validate(
      z.array(accountCreateInputSchema).min(1),
      rows,
      "accounts create",
    );
    if (!validated.ok) return validated;

    // The batch form reads a file path; unlike `ingest commit` it has no stdin mode.
    const file = join(tmpdir(), `oled-accounts-${randomUUID()}.ndjson`);
    const [stageError] = await attemptAsync<void, Error>(() =>
      writeFile(file, toNdjson(validated.value), "utf8"),
    );
    if (stageError !== null) {
      return err<OledError>({
        kind: "cli_error",
        message: `accounts create: could not stage ${file}: ${messageOf(stageError)}`,
      });
    }

    // A virus scan on Windows can briefly lock the file; a temp file left behind is not the batch's failure.
    const out = await exec(["accounts", "create", "--input", file], {
      allowPartial: true,
    }).finally(() => attemptAsync(() => rm(file, { force: true })));
    const page = andThen(out, (stdout) =>
      parseNdjsonRows(
        accountCreateResultSchema,
        stdout,
        accountCreateSummarySchema,
      ),
    );
    return andThen(page, (value) => toBatchOutcome(value, "accounts create"));
  };

  const merchantsUpsert = async (
    input: MerchantUpsertInput,
  ): Promise<Result<MerchantUpsertResult, OledError>> => {
    const validated = validate(
      merchantUpsertInputSchema,
      input,
      "merchants upsert",
    );
    if (!validated.ok) return validated;

    const out = await exec([
      "merchants",
      "upsert",
      ...toFlagArgs(MERCHANT_FLAGS, validated.value),
    ]);
    return andThen(out, (stdout) =>
      parseSingle(merchantUpsertResultSchema, stdout),
    );
  };

  /** Slow lane: OCR on a long scan must not block the reads. */
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
      ...toFlagArgs(PREPARE_FLAGS, opts),
    ];

    return runSingle(args, prepareResultSchema, { lane: "slow" });
  };

  const ingestCommit = async (
    rows: IngestRowInput[],
    opts: { fileId?: string } = {},
  ): Promise<
    Result<WithCommand<BatchOutcome<IngestResult, IngestSummary>>, OledError>
  > => {
    const validated = validate(
      z.array(ingestRowInputSchema).min(1),
      rows,
      "ingest commit",
    );
    if (!validated.ok) return validated;
    if (opts.fileId !== undefined && !FILE_ID_PATTERN.test(opts.fileId)) {
      return err(malformedFileId("ingest commit", opts.fileId));
    }

    const args = [
      "ingest",
      "commit",
      ...toFlagArgs({ fileId: "--file" }, opts),
    ];

    const out = await exec(args, {
      stdin: toNdjson(validated.value),
      allowPartial: true,
    });
    const page = andThen(out, (stdout) =>
      parseNdjsonRows(ingestResultSchema, stdout, ingestSummarySchema),
    );
    const outcome = andThen(page, (value) =>
      toBatchOutcome(value, "ingest commit"),
    );
    return map(outcome, (value) => ({ ...value, command: toCommand(args) }));
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

    const args = ["ingest", "done", fileId, ...toFlagArgs(DONE_FLAGS, opts)];

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
  ): Promise<
    Result<
      WithCommand<ListPage<QuestionAnswerRow, QuestionsAnswerSummary>>,
      OledError
    >
  > => {
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

    const page = andThen(await exec(args), (stdout) =>
      parseNdjsonRows(questionAnswerRowSchema, stdout, QuestionsAnswerSummary),
    );
    return map(page, (value) => ({ ...value, command: toCommand(args) }));
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
      ...toFlagArgs({ days: "--days" }, opts),
    ];

    return runSingle(args, questionDeferRowSchema);
  };

  const transactionAdd = async (
    input: TransactionAddInput,
  ): Promise<Result<WithCommand<TransactionAddResult>, OledError>> => {
    const validated = validate(
      transactionAddInputSchema,
      input,
      "transactions add",
    );
    if (!validated.ok) return validated;

    const args = [
      "transactions",
      "add",
      ...toFlagArgs(TRANSACTION_ADD_FLAGS, validated.value),
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
    const validated = validate(
      transactionUpdateInputSchema,
      patch,
      "transactions update",
    );
    if (!validated.ok) return validated;

    const args = [
      "transactions",
      "update",
      id,
      ...toFlagArgs(TRANSACTION_UPDATE_FLAGS, validated.value),
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
    const validated = validate(
      accountPairSchema,
      input,
      "transactions recategorize",
    );
    if (!validated.ok) return validated;

    const args = [
      "transactions",
      "recategorize",
      "--filter-account",
      validated.value.from,
      "--set-account",
      validated.value.to,
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
    const validated = validate(
      accountCreateInputSchema,
      input,
      "accounts create",
    );
    if (!validated.ok) return validated;

    const args = [
      "accounts",
      "create",
      ...toFlagArgs(ACCOUNT_CREATE_FLAGS, validated.value),
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
    const validated = validate(
      accountUpdateInputSchema,
      patch,
      "accounts update",
    );
    if (!validated.ok) return validated;

    const args = [
      "accounts",
      "update",
      id,
      ...toFlagArgs(ACCOUNT_UPDATE_FLAGS, validated.value),
    ];
    return runSingle(args, accountUpdateResultSchema);
  };

  const accountsMerge = async (input: {
    from: string;
    to: string;
  }): Promise<Result<WithCommand<AccountMergeResult>, OledError>> => {
    const validated = validate(accountPairSchema, input, "accounts merge");
    if (!validated.ok) return validated;

    const args = [
      "accounts",
      "merge",
      "--from",
      validated.value.from,
      "--to",
      validated.value.to,
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
      ...toFlagArgs({ date: "--date" }, opts),
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
    configSet,
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
