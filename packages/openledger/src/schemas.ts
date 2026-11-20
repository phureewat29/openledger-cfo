import {
  CreateAccountBatchSummary as accountCreateSummarySchema,
  Account as accountRowSchema,
  AccountTreeNode as accountTreeNodeSchema,
  AccountType as accountTypeSchema,
  ListAccountsSummary as countSummarySchema,
  IngestFile as ingestFileRowSchema,
  IngestListSummary as ingestFileSummarySchema,
  CommitSummary as ingestSummarySchema,
  CappedSummary as pageSummarySchema,
  AnsweredQuestion as questionAnswerRowSchema,
  DeferredQuestion as questionDeferRowSchema,
  ReportResult as reportSchema,
  StatusReport,
  TextLayer,
  TreeAccountsSummary as treeSummarySchema,
} from "@aquartier/openledger/contract";
import { z } from "zod/v4";

import { ACCOUNT_ID_PATTERN, currencyPrefix, FILE_ID_PATTERN } from "./ids";

export {
  accountCreateSummarySchema,
  accountRowSchema,
  accountTreeNodeSchema,
  countSummarySchema,
  ingestFileRowSchema,
  ingestFileSummarySchema,
  ingestSummarySchema,
  pageSummarySchema,
  questionAnswerRowSchema,
  questionDeferRowSchema,
  reportSchema,
  treeSummarySchema,
};
export type { AccountTreeNode } from "@aquartier/openledger/contract";

export type AccountType = z.infer<typeof accountTypeSchema>;
export type PageSummary = z.infer<typeof pageSummarySchema>;
export type CountSummary = z.infer<typeof countSummarySchema>;
export type TreeSummary = z.infer<typeof treeSummarySchema>;
export type AccountRow = z.infer<typeof accountRowSchema>;
export type QuestionAnswerRow = z.infer<typeof questionAnswerRowSchema>;
export type QuestionDeferRow = z.infer<typeof questionDeferRowSchema>;
export type Report = z.infer<typeof reportSchema>;
export type AccountCreateSummary = z.infer<typeof accountCreateSummarySchema>;
export type IngestSummary = z.infer<typeof ingestSummarySchema>;
export type IngestFileRow = z.infer<typeof ingestFileRowSchema>;
export type IngestFileSummary = z.infer<typeof ingestFileSummarySchema>;

export const accountIdSchema = z
  .string()
  .regex(
    ACCOUNT_ID_PATTERN,
    "Malformed account id (expected thb:expense:food)",
  );

export const fileIdSchema = z
  .string()
  .regex(FILE_ID_PATTERN, "Malformed file id (expected sf-<uuid>)");

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

/** Direction comes from the account pair, never from a sign. */
const amountSchema = z.number().positive().finite();

const summaryLiteral = z.literal("summary");

export const transactionRowSchema = z.object({
  id: z.string(),
  group_id: z.string().nullable(),
  date: z.string(),
  description: z.string(),
  merchant_id: z.string().nullable(),
  raw_descriptor: z.string().nullable(),
  source_file_id: z.string().nullable(),
  source_page: z.number().nullable(),
  debit_account_id: z.string(),
  credit_account_id: z.string(),
  amount: z.number(),
  currency: z.string(),
  void_of: z.string().nullable(),
  created_at: z.string(),
  debit_account_name: z.string().nullable(),
  credit_account_name: z.string().nullable(),
  merchant_name: z.string().nullable(),
});
export type TransactionRow = z.infer<typeof transactionRowSchema>;

export const merchantRowSchema = z.object({
  id: z.string(),
  canonical_name: z.string(),
  default_account_id: z.string().nullable(),
  created_at: z.string(),
  alias_count: z.number(),
});
export type MerchantRow = z.infer<typeof merchantRowSchema>;

export const questionRowSchema = z.object({
  id: z.string(),
  kind: z.string().nullable(),
  prompt: z.string(),
  transaction_id: z.string().nullable(),
  account_id: z.string().nullable(),
  context: z.unknown(),
  file_id: z.string().nullable(),
  created_at: z.string(),
});
export type QuestionRow = z.infer<typeof questionRowSchema>;

// Optional so a pre-contract CLI reaches the gate's error, not parse_failed.
export const statusSchema = StatusReport.extend({
  contract_version: z.number().optional(),
  version: z.string().optional(),
  config_problem: z.string().nullable().optional(),
});
export type Status = z.infer<typeof statusSchema>;

export const accountCreateInputSchema = z.object({
  id: accountIdSchema,
  name: z.string().min(1),
  type: accountTypeSchema,
  parent_id: accountIdSchema.optional(),
  subtype: z.string().optional(),
  bank_name: z.string().optional(),
  account_number_masked: z.string().optional(),
  due_day: z.number().int().min(1).max(31).optional(),
  statement_day: z.number().int().min(1).max(31).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AccountCreateInput = z.infer<typeof accountCreateInputSchema>;

const sharesCurrency = (value: {
  debit_account: string;
  credit_account: string;
}) =>
  currencyPrefix(value.debit_account) === currencyPrefix(value.credit_account);

const SHARED_CURRENCY_MESSAGE =
  "A transaction's two accounts must share one currency prefix";

const merchantHintSchema = z.object({
  canonical_name: z.string().min(1),
  alias: z.string().optional(),
});

const simpleRowInputSchema = z
  .object({
    date: isoDateSchema,
    description: z.string().min(1),
    debit_account: accountIdSchema,
    credit_account: accountIdSchema,
    amount: amountSchema,
    raw_descriptor: z.string().optional(),
    merchant: merchantHintSchema.optional(),
    source_page: z.number().int().optional(),
    row_index: z.number().int().optional(),
  })
  .refine(sharesCurrency, { message: SHARED_CURRENCY_MESSAGE });
export type SimpleRowInput = z.infer<typeof simpleRowInputSchema>;

/** Each leg is single-currency; the legs of one row share a transaction group. */
const linkedLegSchema = z
  .object({
    debit_account: accountIdSchema,
    credit_account: accountIdSchema,
    amount: amountSchema,
  })
  .refine(sharesCurrency, { message: SHARED_CURRENCY_MESSAGE });
export type LinkedLeg = z.infer<typeof linkedLegSchema>;

const linkedRowInputSchema = z.object({
  date: isoDateSchema,
  description: z.string().min(1),
  linked: z.array(linkedLegSchema).min(2),
  raw_descriptor: z.string().optional(),
  merchant: merchantHintSchema.optional(),
  source_page: z.number().int().optional(),
  row_index: z.number().int().optional(),
});
export type LinkedRowInput = z.infer<typeof linkedRowInputSchema>;

export const ingestRowInputSchema = z.union([
  linkedRowInputSchema,
  simpleRowInputSchema,
]);
export type IngestRowInput = z.infer<typeof ingestRowInputSchema>;

// Loose: per-row results carry command-specific extras (sides, legs, failure reasons).
export const accountCreateResultSchema = z.looseObject({
  type: z.literal("result"),
  index: z.number(),
  ok: z.boolean(),
  id: z.string().optional(),
  created: z.boolean().optional(),
  duplicate: z.boolean().optional(),
  created_parents: z.array(z.string()).optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});
export type AccountCreateResult = z.infer<typeof accountCreateResultSchema>;

export const ingestResultSchema = z.looseObject({
  type: z.literal("result"),
  index: z.number(),
  ok: z.boolean(),
  // Simple rows carry transaction_id; linked rows carry group_id plus legs.
  transaction_id: z.string().optional(),
  group_id: z.string().optional(),
  legs: z
    .array(
      z.looseObject({ transaction_id: z.string(), duplicate: z.boolean() }),
    )
    .optional(),
  duplicate: z.boolean().optional(),
  raised_questions: z.number().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

const preparePageSchema = z.looseObject({
  page: z.number(),
  chars: z.number(),
});

export const prepareResultSchema = z.looseObject({
  file_id: z.string(),
  source: z.enum(["text-layer", "ocr"]),
  text_layer: TextLayer,
  page_count: z.number(),
  document: z.string(),
  pages: z.array(preparePageSchema),
});
export type PrepareResult = z.infer<typeof prepareResultSchema>;

const reconciliationSchema = z.looseObject({
  account: z.string(),
  closing: z.number(),
  balance: z.number(),
});

export const ingestDoneResultSchema = z.looseObject({
  file_id: z.string(),
  status: z.literal("ingested"),
  /** Cache directories removed when the file closed; the document goes with them. */
  cache_removed: z.array(z.string()),
  reconciliation: reconciliationSchema.optional(),
});
export type IngestDoneResult = z.infer<typeof ingestDoneResultSchema>;

export const ingestFailResultSchema = z.looseObject({
  file_id: z.string(),
  status: z.literal("failed"),
  cache_removed: z.array(z.string()),
});
export type IngestFailResult = z.infer<typeof ingestFailResultSchema>;

/** What left the ledger with the file: its rows, its questions, its cache. */
export const fileDropResultSchema = z.looseObject({
  file_id: z.string(),
  removed_transactions: z.number(),
  removed_questions: z.number(),
  /** Mirrors elsewhere that voided a dropped row and are live again. */
  unvoided: z.number(),
  cache_removed: z.array(z.string()),
});
export type FileDropResult = z.infer<typeof fileDropResultSchema>;

export const merchantUpsertInputSchema = z.object({
  name: z.string().min(1),
  alias: z.string().optional(),
  default_account: accountIdSchema.optional(),
});
export type MerchantUpsertInput = z.infer<typeof merchantUpsertInputSchema>;

export const merchantUpsertResultSchema = z.looseObject({
  id: z.string(),
  canonical_name: z.string(),
  default_account_id: z.string().nullable(),
  created_at: z.string(),
});
export type MerchantUpsertResult = z.infer<typeof merchantUpsertResultSchema>;

/** Both sides of a move or merge must name the same ledger. */
export const accountPairSchema = z
  .object({ from: accountIdSchema, to: accountIdSchema })
  .refine((pair) => pair.from !== pair.to, {
    message: "from and to are the same account",
  })
  .refine((pair) => currencyPrefix(pair.from) === currencyPrefix(pair.to), {
    message: "accounts are on different currency ledgers",
  });

export const transactionAddInputSchema = z
  .object({
    debit_account: accountIdSchema,
    credit_account: accountIdSchema,
    amount: amountSchema,
    date: isoDateSchema.optional(),
    description: z.string().optional(),
    merchant_name: z.string().optional(),
    /** Create missing account paths and raise questions instead of failing. */
    resolve: z.boolean().optional(),
  })
  .refine(sharesCurrency, { message: SHARED_CURRENCY_MESSAGE });
export type TransactionAddInput = z.infer<typeof transactionAddInputSchema>;

export const transactionAddResultSchema = z.looseObject({
  transaction_id: z.string(),
  duplicate: z.boolean(),
});
export type TransactionAddResult = z.infer<typeof transactionAddResultSchema>;

export const configInitInputSchema = z.object({
  configPath: z.string().min(1),
  db: z.string().min(1),
  dataDir: z.string().min(1),
  cacheDir: z.string().optional(),
  country: z.string().optional(),
  currency: z.string().optional(),
  locale: z.string().optional(),
  userName: z.string().optional(),
});
export type ConfigInitInput = z.infer<typeof configInitInputSchema>;

/** `oled config` answers in camelCase, unlike every read command. */
export const configInitResultSchema = z.looseObject({
  country: z.string(),
  displayLocale: z.string(),
  displayCurrency: z.string(),
  dbPath: z.string(),
  dataDir: z.string(),
  cacheDir: z.string(),
  userName: z.string(),
  config_path: z.string(),
  created: z
    .looseObject({
      config: z.string().optional(),
      db: z.string().optional(),
      data_dir: z.string().optional(),
    })
    .optional(),
});
export type ConfigInitResult = z.infer<typeof configInitResultSchema>;

/** `accounts match` scores the whole chart and answers best match first. */
export const accountMatchRowSchema = z.looseObject({
  account: z.looseObject({
    id: z.string(),
    name: z.string(),
    type: accountTypeSchema,
    parent_id: z.string().nullable(),
    currency: z.string(),
  }),
  similarity: z.number(),
});
export type AccountMatchRow = z.infer<typeof accountMatchRowSchema>;

// Unlike list summaries, `accounts match` reports only what it returned.
export const accountMatchSummarySchema = z.looseObject({
  type: summaryLiteral,
  returned: z.number(),
});
export type AccountMatchSummary = z.infer<typeof accountMatchSummarySchema>;

/** Explicit undefineds count as absent: a patch of only those is no patch. */
const hasAnyField = (patch: Record<string, unknown>): boolean =>
  Object.values(patch).some((value) => value !== undefined);

/** Flag-form create; the batch path in `accountsCreateBatch` answers per row. */
export const accountCreatedResultSchema = z.looseObject({
  id: z.string(),
  created: z.boolean(),
  /** Ancestors the id named that did not exist yet. */
  created_parents: z.array(z.string()).optional(),
});
export type AccountCreatedResult = z.infer<typeof accountCreatedResultSchema>;

export const accountUpdateInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    due_day: z.number().int().min(1).max(31).optional(),
    statement_day: z.number().int().min(1).max(31).optional(),
    points: z.number().optional(),
    bank_name: z.string().optional(),
    account_number_masked: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(hasAnyField, { message: "nothing to update" });
export type AccountUpdateInput = z.infer<typeof accountUpdateInputSchema>;

export const accountUpdateResultSchema = z.looseObject({ id: z.string() });
export type AccountUpdateResult = z.infer<typeof accountUpdateResultSchema>;

/** The from-account is deleted once its rows have moved. */
export const accountMergeResultSchema = z.looseObject({
  from: z.string(),
  to: z.string(),
  moved: z.number(),
  deleted_self_transactions: z.number().optional(),
  moved_merchant_defaults: z.number().optional(),
});
export type AccountMergeResult = z.infer<typeof accountMergeResultSchema>;

/** Posted against `<ccy>:equity:adjustments`; null when the balance already matched. */
export const accountAdjustResultSchema = z.looseObject({
  transaction_id: z.string().nullable(),
  delta: z.number(),
});
export type AccountAdjustResult = z.infer<typeof accountAdjustResultSchema>;

// A non-empty account is refused with "merge it first"; only empty ones delete.
export const accountDeleteResultSchema = z.looseObject({
  id: z.string(),
  deleted: z.boolean(),
});
export type AccountDeleteResult = z.infer<typeof accountDeleteResultSchema>;

/** Metadata only: a row's accounts and amount are immutable once posted. */
export const transactionUpdateInputSchema = z
  .object({
    date: isoDateSchema.optional(),
    description: z.string().min(1).optional(),
    merchant: z.string().min(1).optional(),
  })
  .refine(hasAnyField, { message: "nothing to update" });
export type TransactionUpdateInput = z.infer<
  typeof transactionUpdateInputSchema
>;

export const transactionUpdateResultSchema = z.looseObject({
  transaction_id: z.string(),
  updated: z.boolean(),
});
export type TransactionUpdateResult = z.infer<
  typeof transactionUpdateResultSchema
>;

export const transactionDeleteResultSchema = z.looseObject({
  transaction_id: z.string(),
  deleted: z.boolean(),
  /** Mirrors whose void pointed here and are live again. */
  unvoided: z.number().optional(),
});
export type TransactionDeleteResult = z.infer<
  typeof transactionDeleteResultSchema
>;

export const recategorizeResultSchema = z.looseObject({
  affected: z.number(),
  skipped_self_transaction: z.number().optional(),
  skipped_currency_mismatch: z.number().optional(),
  sample_transaction_ids: z.array(z.string()).optional(),
});
export type RecategorizeResult = z.infer<typeof recategorizeResultSchema>;

/** Merging voids `from`; the row survives under --include-void with void_of set. */
export const transactionMergeResultSchema = z.looseObject({
  from: z.string(),
  to: z.string(),
  voided: z.boolean(),
});
export type TransactionMergeResult = z.infer<
  typeof transactionMergeResultSchema
>;
