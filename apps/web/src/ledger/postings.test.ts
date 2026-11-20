import { describe, expect, it } from "vitest";

import type { TransactionRow } from "./postings";
import { categoryLabelOf, counterpartyOf } from "./postings";

const BANK = "thb:asset:bank:kbank";
const CARD = "thb:liability:credit_card:ktc";
const FOOD = "thb:expense:food:dining";
const SALARY = "thb:income:salary:acme";

const row = (
  debit: string,
  credit: string,
  names: { debit?: string; credit?: string } = {},
): TransactionRow => ({
  id: `${debit}->${credit}`,
  group_id: null,
  date: "2026-11-01",
  description: "",
  merchant_id: null,
  raw_descriptor: null,
  source_file_id: null,
  source_page: null,
  debit_account_id: debit,
  credit_account_id: credit,
  amount: 100,
  currency: "THB",
  void_of: null,
  created_at: "2026-11-01",
  debit_account_name: names.debit ?? null,
  credit_account_name: names.credit ?? null,
  merchant_name: null,
});

describe("categoryLabelOf", () => {
  it("names the expense side of a purchase", () => {
    expect(categoryLabelOf(row(FOOD, CARD, { debit: "Dining" }))).toBe(
      "Dining",
    );
  });

  it("names the income side of a deposit", () => {
    expect(categoryLabelOf(row(BANK, SALARY, { credit: "Salary" }))).toBe(
      "Salary",
    );
  });

  it("falls back to where a transfer landed", () => {
    expect(
      categoryLabelOf(row(CARD, BANK, { debit: "KTC", credit: "KBank" })),
    ).toBe("KTC");
  });
});

describe("counterpartyOf", () => {
  const purchase = row(FOOD, CARD, { debit: "Dining", credit: "KTC" });

  it("names the credit side for the account that was debited", () => {
    expect(counterpartyOf(purchase, FOOD)).toBe("KTC");
  });

  it("names the debit side for the account that was credited", () => {
    expect(counterpartyOf(purchase, CARD)).toBe("Dining");
  });
});
