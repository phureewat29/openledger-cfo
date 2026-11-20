import { groupBy, sumBy, takeWhile } from "es-toolkit";

import type { Posting, TransactionRow } from "./postings";
import type { Point } from "~/lib/charts/data";
import { formatDayMonth, formatMonthAbbr, formatMonthYear } from "~/lib/format";
import { PRIMARY, segmentOf } from "./accounts";
import { lastDayOf, monthOf, monthsBefore, shiftDays } from "./period";
import { toPostings } from "./postings";

/** A year of weekly samples: finer than a balance pane can resolve. */
const WEEKS = 53;
const WEEK_DAYS = 7;

/** Two years of month ends, which is the span the pane is titled for. */
export const TRAJECTORY_MONTHS = 24;

interface Rewind {
  readonly balance: number;
  /** Rows already rewound, counted from the newest. */
  readonly index: number;
  readonly balances: readonly number[];
}

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
): readonly number[] => {
  const newestFirst = rows.toSorted((left, right) =>
    right.date.localeCompare(left.date),
  );
  const deltaOf = (row: TransactionRow) =>
    (row.debit_account_id === accountId) === debitAdds
      ? row.amount
      : -row.amount;

  // Walked newest to oldest so each sample only rewinds what the last one left.
  const rewindTo = (
    { balance, index, balances }: Rewind,
    date: string,
  ): Rewind => {
    const since = takeWhile(newestFirst.slice(index), (row) => row.date > date);
    const rewound = since.reduce((left, row) => left - deltaOf(row), balance);
    return {
      balance: rewound,
      index: index + since.length,
      balances: [rewound, ...balances],
    };
  };
  return dates.reduceRight(rewindTo, {
    balance: current,
    index: 0,
    balances: [],
  }).balances;
};

const pointsOf = (labels: readonly string[], values: readonly number[]) =>
  labels.map((x, index): Point => ({ x, y: values[index] ?? 0 }));

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

/** An asset posting counts holding more as positive, a liability owing more: the side net worth loses. */
const netChange = (postings: readonly Posting[]) =>
  sumBy(postings, (posting) =>
    posting.kind === "asset" ? posting.signed : -posting.signed,
  );

/** Opening balances and currency conversions cross equity without changing what the household owns. */
const isBookkeeping = (row: TransactionRow) =>
  segmentOf(row.debit_account_id, 1) === "equity" ||
  segmentOf(row.credit_account_id, 1) === "equity";

/**
 * Month-end net worth replayed back from today's figure. Foreign holdings stay
 * out, as in the headline: the ledger stores no rate to fold them in with.
 */
export const netWorthSeries = (
  rows: readonly TransactionRow[],
  month: string,
  current: number,
): Point[] => {
  const months = [...monthsBefore(month, TRAJECTORY_MONTHS), month];
  const byMonth = groupBy(
    toPostings(rows.filter((row) => !isBookkeeping(row))).filter(
      (posting) =>
        posting.currency === PRIMARY &&
        (posting.kind === "asset" || posting.kind === "liability"),
    ),
    (posting) => posting.month,
  );

  return months.reduceRight<{ value: number; points: Point[] }>(
    ({ value, points }, key) => ({
      value: value - netChange(byMonth[key] ?? []),
      points: [{ x: formatMonthYear(key), y: Math.round(value) }, ...points],
    }),
    { value: current, points: [] },
  ).points;
};
