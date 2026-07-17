import type { OledCommandListener } from "./exec";
import { resolveOledConfig } from "./config";
import { createReads } from "./reads";
import { createWrites } from "./writes";

export interface CreateOpenLedgerOptions {
  /** Defaults to OLED_CONFIG, else `<workspace root>/.oled/config.json`. */
  configPath?: string;
  /** Fires around every spawned command, for a live log; secrets arrive masked. */
  onCommand?: OledCommandListener;
}

/**
 * Typed, Result-returning front door to the `oled` CLI. Every method resolves
 * to a Result — nothing here throws for an expected failure.
 */
export const createOpenLedger = (opts: CreateOpenLedgerOptions = {}) => {
  const configPath = opts.configPath ?? resolveOledConfig();
  const reads = createReads({ configPath, onCommand: opts.onCommand });
  const writes = createWrites({ configPath, onCommand: opts.onCommand });

  return {
    configPath,
    status: reads.status,
    report: reads.report,
    transactions: {
      list: reads.listTransactions,
      listAll: reads.listAllTransactions,
      add: writes.transactionAdd,
      update: writes.transactionUpdate,
      delete: writes.transactionDelete,
      recategorize: writes.transactionsRecategorize,
      merge: writes.transactionsMerge,
    },
    accounts: {
      list: reads.listAccounts,
      tree: reads.accountsTree,
      match: reads.matchAccounts,
      create: writes.accountsCreate,
      update: writes.accountsUpdate,
      merge: writes.accountsMerge,
      adjust: writes.accountsAdjust,
      delete: writes.accountsDelete,
    },
    merchants: {
      list: reads.listMerchants,
    },
    questions: {
      list: reads.listQuestions,
      answer: writes.questionAnswer,
      defer: writes.questionDefer,
    },
    /** The statement pipeline: list, read, commit, then close as done or failed. */
    ingest: {
      list: reads.ingestList,
      prepare: writes.ingestPrepare,
      document: reads.ingestDocument,
      commit: writes.ingestCommit,
      done: writes.ingestDone,
      fail: writes.ingestFail,
    },
    /** Deregistration, the one move that takes a file back off the books. */
    files: {
      drop: writes.filesDrop,
    },
    config: {
      dataDir: reads.configDataDir,
    },
    /** Standing up a ledger: provisioning and batch posting, not request-path mutations. */
    bootstrap: {
      configInit: writes.configInit,
      accountsCreateBatch: writes.accountsCreateBatch,
      merchantsUpsert: writes.merchantsUpsert,
      ingestCommitBatch: writes.ingestCommitBatch,
    },
  };
};

export type OpenLedger = ReturnType<typeof createOpenLedger>;

export { resolveOledConfig } from "./config";
export type { OledConfigFile } from "./config";
/**
 * Re-exported for callers that already hold the client. Both modules are pure
 * and import nothing, so a caller that must stay off the server — a browser
 * bundle — imports `@openledger-fleet/openledger/ids` or `/calendar` directly
 * rather than this barrel, which reaches the CLI and `node:child_process`.
 */
export { isoToday } from "./calendar";
export { categoryOf, matchesPrefix } from "./ids";
export { EXIT_KIND } from "./errors";
export type { OledError, OledErrorKind } from "./errors";
export { quoteShellArg } from "./exec";
export type { OledCommandEvent, OledCommandListener } from "./exec";
export { err, ok } from "./result";
export type { Result } from "./result";
export type {
  IngestDocument,
  ListPage,
  PageOptions,
  ReportRange,
  TransactionFilters,
} from "./reads";
export type {
  BatchOutcome,
  IngestDoneOptions,
  IngestPrepareOptions,
  WithCommand,
} from "./writes";
export {
  ACCOUNT_ID_PATTERN,
  accountCreateInputSchema,
  accountIdSchema,
  FILE_ID_PATTERN,
  ingestRowInputSchema,
  isoDateSchema,
  merchantUpsertInputSchema,
  transactionAddInputSchema,
} from "./schemas";
/**
 * Most of these are named by nothing in this repo's source. They are still
 * load-bearing: `packages/api` and `packages/agent` emit declarations, and
 * `createOpenLedger`'s inferred return type prints them as
 * `import("@openledger-fleet/openledger").X`. This package exposes no
 * subpath for these schema types, so there is no deep-import fallback —
 * dropping one turns into TS2742 in a consumer's build.
 */
export type {
  AccountAdjustResult,
  AccountCreatedResult,
  AccountCreateInput,
  AccountCreateResult,
  AccountCreateSummary,
  AccountDeleteResult,
  AccountMatchRow,
  AccountMatchSummary,
  AccountMergeResult,
  AccountRow,
  AccountTreeNode,
  AccountType,
  AccountUpdateInput,
  AccountUpdateResult,
  ConfigInitInput,
  ConfigInitResult,
  CountSummary,
  FileDropResult,
  IngestDoneResult,
  IngestFailResult,
  IngestFileRow,
  IngestFileSummary,
  IngestResult,
  IngestRowInput,
  IngestSummary,
  LinkedLeg,
  LinkedRowInput,
  MerchantRow,
  MerchantUpsertInput,
  MerchantUpsertResult,
  PageSummary,
  PrepareResult,
  QuestionAnswerRow,
  QuestionDeferRow,
  QuestionRow,
  RecategorizeResult,
  Report,
  SimpleRowInput,
  Status,
  TransactionAddInput,
  TransactionAddResult,
  TransactionDeleteResult,
  TransactionMergeResult,
  TransactionRow,
  TransactionUpdateInput,
  TransactionUpdateResult,
  TreeSummary,
} from "./schemas";
