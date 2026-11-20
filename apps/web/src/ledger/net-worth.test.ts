import { describe, expect, it } from "vitest";

import type { TransactionRow } from "./postings";
import { netWorthSeries, TRAJECTORY_MONTHS } from "./net-worth";

const row = (
  date: string,
  amount: number,
  debit: string,
  credit: string,
): TransactionRow => ({
  id: `${date}:${debit}`,
  group_id: null,
  date,
  description: "",
  merchant_id: null,
  raw_descriptor: null,
  source_file_id: null,
  source_page: null,
  debit_account_id: debit,
  credit_account_id: credit,
  amount,
  currency: "THB",
  void_of: null,
  created_at: date,
  debit_account_name: null,
  credit_account_name: null,
  merchant_name: null,
});

describe("netWorthSeries", () => {
  it("replays each month end backwards from today's figure, oldest first", () => {
    const rows = [
      row("2026-03-10", 100, "thb:asset:bank:a", "thb:income:salary:x"),
      row("2026-02-12", 50, "thb:expense:food:b", "thb:liability:card:c"),
    ];
    const points = netWorthSeries(rows, "2026-03", 1000.4);
    expect(points).toHaveLength(TRAJECTORY_MONTHS + 1);
    expect(points.slice(-3).map((point) => point.y)).toEqual([950, 900, 1000]);
    expect(points[0]?.y).toBe(950);
  });

  it("leaves out bookkeeping and foreign holdings", () => {
    const rows = [
      row("2026-03-01", 500, "thb:asset:bank:a", "thb:equity:opening"),
      row("2026-03-02", 7, "usd:asset:brokerage:d", "usd:income:dividend:e"),
    ];
    const points = netWorthSeries(rows, "2026-03", 1000);
    expect(new Set(points.map((point) => point.y))).toEqual(new Set([1000]));
  });
});
