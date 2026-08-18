import { groupBy, orderBy, sumBy } from "es-toolkit";

import type { TransactionRow } from "../postings";
import type { BarSeries, CategoryTotal, Point } from "./types";
import { categoryOf } from "../accounts";
import {
  accountLabel,
  formatDayMonth,
  formatMonthAbbr,
  formatMonthYear,
} from "../format";
import { payoffProjection } from "../loans";
import { lastDayOf, monthOf, shiftDays, shiftMonth } from "../period";

const TOP_CATEGORIES = 5;
const OTHER_KEY = "other";
/** A year of weekly samples: finer than a balance pane can resolve. */
const WEEKS = 53;
const WEEK_DAYS = 7;

const totalOf = (rows: readonly TransactionRow[]) =>
  sumBy(rows, (row) => row.amount);

const inMonth = (rows: readonly TransactionRow[], month: string) =>
  rows.filter((row) => monthOf(row.date) === month);

/** A card purchase credits the card and debits whatever it paid for. */
const spendLegs = (rows: readonly TransactionRow[], cardId: string) =>
  rows.filter((row) => row.credit_account_id === cardId);

const rankedCategories = (rows: readonly TransactionRow[]) =>
  orderBy(
    Object.entries(groupBy(rows, (row) => categoryOf(row.debit_account_id))),
    [([, group]) => totalOf(group)],
    ["desc"],
  );

/** Every category the card paid, for the caller to rank and fold. */
export const cardCategories = (
  rows: readonly TransactionRow[],
  cardId: string,
  from: string,
): CategoryTotal[] =>
  rankedCategories(
    spendLegs(rows, cardId).filter((row) => row.date > from),
  ).map(([key, group]) => ({
    key,
    label: accountLabel(key),
    value: totalOf(group),
  }));

/**
 * Monthly spend split by category. The ranking is taken over the whole window,
 * never per month, so a band keeps its tone as the columns change.
 */
export const cardSpend = (
  rows: readonly TransactionRow[],
  cardId: string,
  months: readonly string[],
): BarSeries[] => {
  const covered = new Set(months);
  const legs = spendLegs(rows, cardId).filter((row) =>
    covered.has(monthOf(row.date)),
  );
  const ranked = rankedCategories(legs);
  const valuesOf = (group: readonly TransactionRow[]) =>
    months.map((month) => totalOf(inMonth(group, month)));

  const top = ranked.slice(0, TOP_CATEGORIES).map(
    ([key, group]): BarSeries => ({
      key,
      label: accountLabel(key),
      values: valuesOf(group),
    }),
  );
  const rest = ranked.slice(TOP_CATEGORIES).flatMap(([, group]) => group);
  if (rest.length === 0) return top;
  return [...top, { key: OTHER_KEY, label: "Other", values: valuesOf(rest) }];
};

/** Principal repays the loan account itself; interest never touches it. */
export const loanSplit = (
  rows: readonly TransactionRow[],
  loanId: string,
  interest: readonly TransactionRow[],
  months: readonly string[],
): { principal: number[]; interest: number[] } => {
  const paid = rows.filter((row) => row.debit_account_id === loanId);
  return {
    principal: months.map((month) => totalOf(inMonth(paid, month))),
    interest: months.map((month) => totalOf(inMonth(interest, month))),
  };
};

/**
 * The ledger stores one balance, not a history of them, so every earlier
 * balance is today's minus everything that has happened since.
 */
const replay = (
  rows: readonly TransactionRow[],
  accountId: string,
  dates: readonly string[],
  current: number,
  debitAdds: boolean,
): number[] => {
  const newestFirst = rows.toSorted((left, right) =>
    right.date.localeCompare(left.date),
  );
  const deltaOf = (row: TransactionRow) =>
    (row.debit_account_id === accountId) === debitAdds
      ? row.amount
      : -row.amount;

  // Walked newest to oldest so each sample only rewinds what the last one left.
  let balance = current;
  let index = 0;
  const balances = dates.toReversed().map((date) => {
    while (index < newestFirst.length) {
      const row = newestFirst[index];
      if (row === undefined || row.date <= date) break;
      balance -= deltaOf(row);
      index += 1;
    }
    return balance;
  });
  return balances.reverse();
};

const pointsOf = (labels: readonly string[], values: readonly number[]) =>
  labels.map((x, index): Point => ({ x, y: values[index] ?? 0 }));

/**
 * A balance is sampled on a fixed grid, so a dormant account still yields a
 * full run of points — every one at the same level. That is a series with
 * nothing to show rather than a short one, which is what a caller has to know
 * before it offers a plot.
 */
export const hasMovement = (points: readonly Point[]): boolean =>
  points.some((point) => point.y !== points[0]?.y);

/** The window's complete months, then the month still running. */
const sampleMonths = (months: readonly string[], asOf: string) => {
  const keys = [...months, monthOf(asOf)];
  return { keys, dates: [...months.map(lastDayOf), asOf] };
};

/** The months `monthlyBalance` plots, in order, so a caller can mark points on it. */
export const balanceMonthKeys = (
  months: readonly string[],
  asOf: string,
): readonly string[] => sampleMonths(months, asOf).keys;

/** Month-end levels, oldest first — the shape of an asset or a debt. */
export const monthlyBalance = (
  rows: readonly TransactionRow[],
  accountId: string,
  months: readonly string[],
  asOf: string,
  current: number,
  debitAdds: boolean,
): Point[] => {
  const { keys, dates } = sampleMonths(months, asOf);
  return pointsOf(
    keys.map(formatMonthAbbr),
    replay(rows, accountId, dates, current, debitAdds),
  );
};

/**
 * A spending account moves too often for month ends to describe it, and too
 * little for every posting day to be worth plotting.
 */
export const weeklyBalance = (
  rows: readonly TransactionRow[],
  accountId: string,
  asOf: string,
  current: number,
  weeks: number = WEEKS,
): Point[] => {
  const dates = Array.from({ length: weeks }, (_, index) =>
    shiftDays(asOf, (index - weeks + 1) * WEEK_DAYS),
  );
  return pointsOf(
    dates.map(formatDayMonth),
    replay(rows, accountId, dates, current, true),
  );
};

/**
 * Where the debt lands if it keeps being repaid at the pace already seen. A
 * tail longer than the history it was inferred from would squeeze that history
 * out of the plot, and a shape nobody can read is not a projection — so past
 * that horizon the chart says nothing rather than something shapeless.
 */
export const payoffPoints = (
  balance: readonly Point[],
  principal: readonly number[],
  current: number,
  asOf: string,
): Point[] => {
  const months = payoffProjection(principal, current);
  if (months === undefined || months > balance.length) return [];
  const from = monthOf(asOf);
  return Array.from(
    { length: months },
    (_, step): Point => ({
      x: formatMonthYear(shiftMonth(from, step + 1)),
      y: Math.max(current - (current / months) * (step + 1), 0),
    }),
  );
};
