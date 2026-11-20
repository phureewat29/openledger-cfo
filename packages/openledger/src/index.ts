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

/** Typed front door to the `oled` CLI: every method resolves to a Result, never throws for an expected failure. */
export const createOpenLedger = (opts: CreateOpenLedgerOptions = {}) => {
  const context = {
    configPath: opts.configPath ?? resolveOledConfig(),
    onCommand: opts.onCommand,
  };
  const reads = createReads(context);
  const writes = createWrites(context);

  return {
    configPath: context.configPath,
    status: reads.status,
    report: reads.report,
    transactions: {
      list: reads.listTransactions,
      listAll: reads.listAllTransactions,
      listByFile: reads.listTransactionsByFile,
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
    ingest: {
      list: reads.ingestList,
      prepare: writes.ingestPrepare,
      document: reads.ingestDocument,
      commit: writes.ingestCommit,
      done: writes.ingestDone,
      fail: writes.ingestFail,
    },
    files: {
      drop: writes.filesDrop,
    },
    config: {
      dataDir: reads.configDataDir,
    },
    /** Ledger provisioning and batch posting, kept off the request path. */
    bootstrap: {
      configInit: writes.configInit,
      accountsCreateBatch: writes.accountsCreateBatch,
      merchantsUpsert: writes.merchantsUpsert,
      ingestCommitBatch: writes.ingestCommit,
    },
  };
};

export type OpenLedger = ReturnType<typeof createOpenLedger>;

export { findWorkspaceRoot, WORKSPACE_MARKER } from "./config";
// Pure; browser code imports these from the /ids and /calendar subpaths, since this barrel spawns the CLI.
export { isoToday } from "./calendar";
export { categoryOf, matchesPrefix } from "./ids";
export type { OledError, OledErrorKind } from "./errors";
export { quoteShellArg, SECRET_MASK } from "./argv";
export type { OledCommandEvent, OledCommandListener } from "./exec";
export { andThen, err, messageOf, ok, unwrapOr } from "./result";
export type { Result } from "./result";
export type { ListPage } from "./ndjson";
export type {
  IngestDocument,
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
  accountCreateInputSchema,
  accountIdSchema,
  fileIdSchema,
  ingestRowInputSchema,
  isoDateSchema,
  merchantUpsertInputSchema,
  transactionAddInputSchema,
} from "./schemas";
// Consumers' declaration emit prints these by name; dropping one is TS2742 in their build.
export type { QuestionsAnswerSummary } from "@aquartier/openledger/contract";
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
