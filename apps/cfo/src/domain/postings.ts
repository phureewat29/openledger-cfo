import { sum, sumBy } from "es-toolkit";

import type { RouterOutputs } from "@openledger-fleet/api";
import {
  sanitizeLabel,
  sanitizeOptional,
} from "@openledger-fleet/agent/sanitize";

import { categoryOf } from "./accounts";
import { dayOf, monthOf } from "./period";

export type TransactionRow =
  RouterOutputs["ledger"]["transactions"]["listAll"][number];

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

export const segmentOf = (accountId: string, index: number) =>
  accountId.split(":")[index] ?? "";

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

export const total = (postings: readonly Posting[]) =>
  sumBy(postings, (posting) => posting.signed);

export const inMonth = (postings: readonly Posting[], month: string) =>
  postings.filter((posting) => posting.month === month);

export const upToDay = (postings: readonly Posting[], day: number) =>
  postings.filter((posting) => posting.day <= day);

export const average = (values: readonly number[]) =>
  values.length === 0 ? 0 : sum(values) / values.length;

export const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
