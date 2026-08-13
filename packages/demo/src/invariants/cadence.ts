import type { Life } from "../dataset";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { dayIn, eachMonth, lastDayIn, monthKey } from "../calendar";
import { legsOf } from "../types";
import { check } from "./shared";

/**
 * The fixed obligations are the ones a reader will scroll for, so every whole
 * month has to show both paydays and every loan that had not yet been settled.
 */
export const cadenceCheck = (life: Life, rows: SeedRow[]): Check => {
  const income = life.meta.products.incomeSources;
  const seen = new Map<string, Set<string>>();

  const note = (account: string, date: string): void => {
    const months = seen.get(account) ?? new Set<string>();
    months.add(monthKey(date));
    seen.set(account, months);
  };

  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      if (income.some((source) => source.account === entry.credit_account)) {
        note(entry.credit_account, seedRow.date);
      }
      if (
        life.meta.products.loans.some(
          (loan) => loan.account === entry.debit_account,
        )
      ) {
        note(entry.debit_account, seedRow.date);
      }
    }
  }

  const fullMonths = eachMonth(life.meta.window).filter(
    (month) =>
      dayIn(month, 1) >= life.meta.window.start &&
      lastDayIn(month) <= life.meta.window.end,
  );

  const gaps: string[] = [];
  for (const month of fullMonths) {
    const key = monthKey(dayIn(month, 1));
    for (const source of income) {
      if (!seen.get(source.account)?.has(key))
        gaps.push(`${key} ${source.key}`);
    }
    for (const loan of life.meta.products.loans) {
      const settled =
        (life.meta.expected.loanBalances[loan.account] ?? 0) === 0;
      const lastMonth = [...(seen.get(loan.account) ?? [])].sort().at(-1) ?? "";
      if (settled && key > lastMonth) continue;
      if (!seen.get(loan.account)?.has(key)) gaps.push(`${key} ${loan.key}`);
    }
  }

  return check(
    "every full month pays both incomes and every live loan",
    gaps.length === 0,
    gaps.slice(0, 5).join(", "),
  );
};
