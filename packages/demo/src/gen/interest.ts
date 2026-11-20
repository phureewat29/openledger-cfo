import { takeWhile } from "es-toolkit";

import type { Bank } from "../products/banks";
import type { SeedContext, SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
import { lastDayIn, within } from "../calendar";
import { fromUnits } from "../money";
import { QUARTER_END_MONTHS } from "../persona";
import { BANKS } from "../products/banks";
import { deltasOf, row } from "../rows";

const BANK_IDS = new Set(BANKS.map((bank) => bank.account));

const PERIODS: Record<Bank["cadence"], number> = { monthly: 12, quarterly: 4 };

/**
 * Credited on the balance actually held. Runs last: a credit only raises a
 * balance, so no refill placed earlier can be invalidated.
 */
export const applyInterest = (ctx: SeedContext, rows: SeedRow[]): SeedRow[] => {
  const schedule = new Map(
    ctx.months
      .map((month) => ({ month, date: lastDayIn(month) }))
      .filter(({ date }) => within(date, ctx.window))
      .map(({ month, date }) => [
        date,
        BANKS.filter(
          (bank) =>
            bank.cadence === "monthly" ||
            QUARTER_END_MONTHS.includes(month.month),
        ),
      ]),
  );

  const dates = [...schedule.keys()].sort();
  const balances = new Map<string, number>();
  const out: SeedRow[] = [];
  let cursor = 0;

  const creditInterest = (date: string): void => {
    for (const bank of schedule.get(date) ?? []) {
      const balanceUnits = balances.get(bank.account) ?? 0;
      const interestUnits = Math.round(
        (balanceUnits * bank.annualRate) / PERIODS[bank.cadence],
      );
      if (interestUnits <= 0) continue;
      balances.set(bank.account, balanceUnits + interestUnits);
      out.push(
        row({
          date,
          description: `Interest — ${bank.name}`,
          debit: bank.account,
          credit: ACCOUNT.interestIncome,
          amount: fromUnits(interestUnits),
        }),
      );
    }
  };

  const flushBefore = (limit: string | undefined): void => {
    const due = takeWhile(
      dates.slice(cursor),
      (date) => limit === undefined || date < limit,
    );
    due.forEach(creditInterest);
    cursor += due.length;
  };

  for (const seedRow of rows) {
    flushBefore(seedRow.date);
    for (const [account, units] of deltasOf(seedRow, BANK_IDS)) {
      balances.set(account, (balances.get(account) ?? 0) + units);
    }
    out.push(seedRow);
  }
  flushBefore(undefined);

  return out;
};
