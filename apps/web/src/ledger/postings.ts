import type { TransactionRow } from "@openledger-cfo/openledger";
import {
  sanitizeLabel,
  sanitizeOptional,
} from "@openledger-cfo/agent/sanitize";

import { accountLabel, categoryOf, segmentOf } from "./accounts";
import { dayOf, monthOf } from "./period";

export type { TransactionRow };

export interface Posting {
  readonly date: string;
  readonly month: string;
  readonly day: number;
  readonly account: string;
  /** The ledger's own transaction group, the only link between two legs. */
  readonly group_id: string | null;
  readonly currency: string;
  readonly kind: string;
  /** Third segment: `bank`, `subscriptions`, `credit_card`, … */
  readonly group: string;
  readonly category: string;
  /** Account display name from the row side, when the ledger sent one. */
  readonly name: string | null;
  readonly amount: number;
  /** Amount with the account's natural sign applied, matching `ledger.report`. */
  readonly signed: number;
  readonly label: string;
  readonly merchant: string | null;
}

/** The leg that says what the money was for: the expense or income side, else the debit side. */
export const categoryLabelOf = (row: TransactionRow): string => {
  if (segmentOf(row.debit_account_id, 1) === "expense") {
    return accountLabel(row.debit_account_id, row.debit_account_name);
  }
  if (segmentOf(row.credit_account_id, 1) === "income") {
    return accountLabel(row.credit_account_id, row.credit_account_name);
  }
  return accountLabel(row.debit_account_id, row.debit_account_name);
};

/** The leg `accountId` is not on: who it traded with. */
export const counterpartyOf = (row: TransactionRow, accountId: string) =>
  row.debit_account_id === accountId
    ? accountLabel(row.credit_account_id, row.credit_account_name)
    : accountLabel(row.debit_account_id, row.debit_account_name);

export const toPosting = (
  row: TransactionRow,
  accountId: string,
  name: string | null,
  side: "debit" | "credit",
): Posting => {
  const parts = accountId.split(":");
  const kind = parts[1] ?? "";
  const debitPositive = kind === "asset" || kind === "expense";
  const positive = (side === "debit") === debitPositive;
  return {
    date: row.date,
    month: monthOf(row.date),
    day: dayOf(row.date),
    account: accountId,
    group_id: row.group_id,
    currency: parts[0] ?? "",
    kind,
    group: parts[2] ?? "",
    category: categoryOf(accountId),
    name,
    amount: row.amount,
    signed: positive ? row.amount : -row.amount,
    label: sanitizeLabel(row.description),
    merchant: sanitizeOptional(row.merchant_name),
  };
};

export const toPostings = (rows: readonly TransactionRow[]): Posting[] =>
  rows.flatMap((row) => [
    toPosting(row, row.debit_account_id, row.debit_account_name, "debit"),
    toPosting(row, row.credit_account_id, row.credit_account_name, "credit"),
  ]);

export const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
