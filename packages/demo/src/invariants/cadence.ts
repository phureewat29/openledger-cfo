import { groupBy, mapValues } from "es-toolkit";

import type { Life } from "../dataset";
import type { SeedRow } from "../rows";
import type { Check } from "./shared";
import { dayIn, eachMonth, isWholeMonth, monthKey } from "../calendar";
import { legsOf } from "../rows";
import { check } from "./shared";

export const cadenceCheck = (life: Life, rows: SeedRow[]): Check => {
  const { incomeSources: income, loans } = life.meta.products;
  const incomeAccounts = new Set(income.map((source) => source.account));
  const loanAccounts = new Set(loans.map((loan) => loan.account));

  const postings = rows.flatMap((seedRow) =>
    legsOf(seedRow).flatMap((entry) => [
      ...(incomeAccounts.has(entry.credit_account)
        ? [{ account: entry.credit_account, month: monthKey(seedRow.date) }]
        : []),
      ...(loanAccounts.has(entry.debit_account)
        ? [{ account: entry.debit_account, month: monthKey(seedRow.date) }]
        : []),
    ]),
  );
  const seen = mapValues(
    groupBy(postings, ({ account }) => account),
    (group) => new Set(group.map(({ month }) => month)),
  );

  const fullMonths = eachMonth(life.meta.window).filter((month) =>
    isWholeMonth(month, life.meta.window),
  );

  const gaps = fullMonths.flatMap((month) => {
    const key = monthKey(dayIn(month, 1));
    const missingIncome = income
      .filter((source) => !seen[source.account]?.has(key))
      .map((source) => `${key} ${source.key}`);
    const missingLoans = loans
      .filter((loan) => {
        const settled =
          (life.meta.expected.loanBalances[loan.account] ?? -1) === 0;
        const lastMonth = [...(seen[loan.account] ?? [])].sort().at(-1) ?? "";
        return !(settled && key > lastMonth) && !seen[loan.account]?.has(key);
      })
      .map((loan) => `${key} ${loan.key}`);
    return [...missingIncome, ...missingLoans];
  });

  return check(
    "every full month pays both incomes and every live loan",
    gaps.length === 0,
    gaps.slice(0, 5).join(", "),
  );
};
