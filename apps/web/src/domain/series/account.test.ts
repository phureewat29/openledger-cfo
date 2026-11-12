import { describe, expect, it } from "vitest";

import type { TransactionRow } from "../postings";
import type { Point } from "./types";
import { monthlyBalance, paddedDomain, weeklyBalance } from "./account";

const BANK = "thb:asset:bank:a";
const FOOD = "thb:expense:food:b";
const LOAN = "thb:liability:loan:c";

const row = (
  date: string,
  amount: number,
  debit = BANK,
  credit = FOOD,
): TransactionRow => ({
  id: `${date}:${String(amount)}`,
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

const ys = (points: readonly Point[]) => points.map((point) => point.y);

describe("monthlyBalance", () => {
  it("rewinds each month end from today's balance", () => {
    const rows = [
      row("2026-02-15", 0.7),
      row("2026-03-20", 0.1),
      row("2026-01-10", 0.2),
    ];
    const points = monthlyBalance(
      rows,
      BANK,
      ["2026-01", "2026-02"],
      "2026-03-31",
      1,
      true,
    );
    expect(points).toHaveLength(3);
    expect(ys(points)).toEqual([1 - 0.1 - 0.7, 1 - 0.1, 1]);
  });

  it("subtracts one posting at a time, newest first", () => {
    // Every other order of the same three amounts lands on a different float.
    expect(1 - 0.1 - 0.7 - 0.2).not.toBe(1 - 0.2 - 0.7 - 0.1);
    expect(1 - 0.1 - 0.7 - 0.2).not.toBe(1 - (0.1 + 0.7 + 0.2));
    const rows = [
      row("2026-03-15", 0.7),
      row("2026-03-10", 0.2),
      row("2026-03-20", 0.1),
    ];
    const points = monthlyBalance(
      rows,
      BANK,
      ["2026-02"],
      "2026-03-31",
      1,
      true,
    );
    expect(ys(points)).toEqual([1 - 0.1 - 0.7 - 0.2, 1]);
  });

  it("keeps a posting on the sample day in that day's balance", () => {
    const points = monthlyBalance(
      [row("2026-02-28", 5)],
      BANK,
      ["2026-02"],
      "2026-03-31",
      10,
      true,
    );
    expect(ys(points)).toEqual([10, 10]);
  });

  it("reads a debt with credits adding to it", () => {
    const rows = [
      row("2026-03-05", 100, LOAN, BANK),
      row("2026-03-06", 30, FOOD, LOAN),
    ];
    const points = monthlyBalance(
      rows,
      LOAN,
      ["2026-02"],
      "2026-03-31",
      900,
      false,
    );
    expect(ys(points)).toEqual([900 - 30 + 100, 900]);
  });
});

describe("weeklyBalance", () => {
  it("samples whole weeks back from the as-of date", () => {
    const rows = [row("2026-03-25", 50), row("2026-03-18", 20, FOOD, BANK)];
    const points = weeklyBalance(rows, BANK, "2026-03-31", 200, 3);
    expect(ys(points)).toEqual([200 - 50 + 20, 200 - 50, 200]);
  });
});

describe("paddedDomain", () => {
  it("lends a flat series the minimum span, evenly at both ends", () => {
    expect(paddedDomain(5, 5)).toEqual({ low: 4.5, high: 5.5 });
  });

  it("lends a narrow series only its shortfall", () => {
    expect(paddedDomain(2, 2.5)).toEqual({ low: 1.75, high: 2.75 });
  });

  it("leaves a series wider than the minimum as drawn", () => {
    expect(paddedDomain(-3, 10)).toEqual({ low: -3, high: 10 });
  });
});
