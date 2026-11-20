import { groupBy, sumBy } from "es-toolkit";

import type { Posting, TransactionRow } from "./postings";
import type { Point } from "~/lib/charts/data";
import { formatMonthYear } from "~/lib/format";
import { PRIMARY } from "./accounts";
import { monthsBefore } from "./period";
import { segmentOf, toPostings } from "./postings";

/** Two years of month ends, which is the span the pane is titled for. */
export const TRAJECTORY_MONTHS = 24;

/**
 * What a month did to net worth. An asset posting is signed so that holding
 * more is positive; a liability posting is signed so that owing more is
 * positive, which is the direction net worth loses.
 */
const netChange = (postings: readonly Posting[]) =>
  sumBy(postings, (posting) =>
    posting.kind === "asset" ? posting.signed : -posting.signed,
  );

/**
 * An opening balance and a currency conversion both cross an equity account:
 * the first is where the ledger began keeping score, the second is the same
 * money in another denomination. Neither made the household richer or poorer,
 * and counting them would rewind the whole balance sheet to zero at the ledger's
 * first month, or read a baht-to-dollar transfer as a loss.
 */
const isBookkeeping = (row: TransactionRow) =>
  segmentOf(row.debit_account_id, 1) === "equity" ||
  segmentOf(row.credit_account_id, 1) === "equity";

/**
 * Net worth replayed backwards from what the ledger holds today: the balance
 * sheet is a running total, so each earlier month end is the one after it less
 * that month's change. Foreign holdings are left out, exactly as the headline
 * figure leaves them out — the ledger stores no rate to fold them in with.
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
