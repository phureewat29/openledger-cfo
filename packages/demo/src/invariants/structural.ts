import { difference } from "es-toolkit";

import type { AccountCreateInput } from "@openledger-cfo/openledger";

import type { Life } from "../dataset";
import type { Totals } from "../expected";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { monthKey, within } from "../calendar";
import { toUnits } from "../money";
import { legsOf } from "../types";
import { check, detail } from "./shared";

const leafIds = (accounts: AccountCreateInput[]): string[] =>
  accounts
    .filter(
      (account) =>
        !accounts.some((other) => other.id.startsWith(`${account.id}:`)),
    )
    .map((account) => account.id);

export const coverageChecks = (life: Life, rows: SeedRow[]): Check[] => {
  const posted = new Set(
    rows
      .flatMap(legsOf)
      .flatMap((entry) => [entry.debit_account, entry.credit_account]),
  );

  const dead = difference(leafIds(life.accounts), [...posted]);
  const counts = life.meta.expected.counts;
  const products = life.meta.products;

  const floors: [label: string, count: number, minimum: number][] = [
    ["banks", products.banks.length, 7],
    ["cards", products.cards.length, 4],
    [
      "mortgages",
      products.loans.filter((loan) => loan.category === "mortgage").length,
      2,
    ],
    [
      "personal loans",
      products.loans.filter((loan) => loan.category === "personal").length,
      2,
    ],
    [
      "stocks",
      products.holdings.filter((holding) => holding.kind === "stock").length,
      10,
    ],
    ["funds", products.funds.length, 3],
    ["crypto", products.coins.length, 3],
    ["income sources", products.incomeSources.length, 2],
  ];
  const shortfalls = floors
    .filter(([, count, minimum]) => count < minimum)
    .map(([label]) => label);

  const unposted = [
    ...products.banks.map((bank) => bank.account),
    ...products.cards.map((card) => card.account),
    ...products.loans.map((loan) => loan.account),
    ...products.holdings.map((holding) => holding.account),
    ...products.funds.map((fund) => fund.account),
    ...products.coins.map((coin) => coin.account),
    ...products.incomeSources.map((source) => source.account),
  ].filter((account) => !posted.has(account));

  return [
    check(
      "every charted account carries a posting",
      dead.length === 0,
      dead.join(", "),
    ),
    check(
      "product coverage meets the persona",
      shortfalls.length === 0 && unposted.length === 0,
      [
        shortfalls.length > 0 ? `too few ${shortfalls.join(", ")}` : "",
        unposted.length > 0 ? `never posted: ${unposted.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ") ||
        `${String(counts.banks)} banks, ${String(counts.cards)} cards, ${String(counts.mortgages)} mortgages, ${String(counts.personalLoans)} personal loans, ${String(counts.stocks)} stocks, ${String(counts.etfs)} etf, ${String(counts.funds)} funds, ${String(counts.coins)} crypto, ${String(counts.incomeSources)} income sources`,
    ),
  ];
};

/** The dataset states its own totals; folding the rows again is what makes them a claim. */
export const totalsCheck = (life: Life, totals: Totals): Check[] => {
  const expected = life.meta.expected;

  const mismatched = Object.entries(totals.balances).filter(
    ([account, balance]) =>
      toUnits(expected.balances[account] ?? 0) !== toUnits(balance),
  );

  return [
    check(
      "rows only touch charted accounts",
      totals.unknownAccounts.length === 0,
      totals.unknownAccounts.join(", "),
    ),
    check(
      "counts and sums match the dataset's own totals",
      totals.rows === expected.rows &&
        totals.transactions === expected.transactions &&
        toUnits(totals.income.THB ?? 0) === toUnits(expected.thbIncome) &&
        toUnits(totals.expenses.THB ?? 0) === toUnits(expected.thbExpenses) &&
        toUnits(totals.income.USD ?? 0) === toUnits(expected.usdIncome) &&
        mismatched.length === 0,
      `${String(totals.rows)} rows, ${String(totals.transactions)} legs${mismatched.length > 0 ? `, ${String(mismatched.length)} balances differ` : ""}`,
    ),
  ];
};

export const chunkCheck = (life: Life): Check => {
  const faults = life.months.flatMap((chunk, index) => [
    ...(chunk.month <= (life.months[index - 1]?.month ?? "")
      ? [`${chunk.month} out of order`]
      : []),
    ...chunk.rows.flatMap((seedRow) => [
      ...(monthKey(seedRow.date) === chunk.month
        ? []
        : [`${seedRow.date} filed under ${chunk.month}`]),
      ...(within(seedRow.date, life.meta.window)
        ? []
        : [`${seedRow.date} outside the window`]),
    ]),
  ]);

  return check(
    "months are ordered and hold only their own rows",
    faults.length === 0,
    detail(faults),
  );
};
