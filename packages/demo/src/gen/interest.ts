import type { Bank } from "../products/banks";
import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT } from "../accounts";
import { lastDayIn, within } from "../calendar";
import { fromUnits, toUnits } from "../money";
import { QUARTER_END_MONTHS } from "../persona";
import { BANKS } from "../products/banks";
import { legsOf, row } from "../types";

const BANK_IDS = new Set(BANKS.map((bank) => bank.account));

const PERIODS: Record<Bank["cadence"], number> = { monthly: 12, quarterly: 4 };

const applyRow = (balances: Map<string, number>, seedRow: SeedRow): void => {
  for (const entry of legsOf(seedRow)) {
    const units = toUnits(entry.amount);
    if (BANK_IDS.has(entry.debit_account)) {
      const account = entry.debit_account;
      balances.set(account, (balances.get(account) ?? 0) + units);
    }
    if (BANK_IDS.has(entry.credit_account)) {
      const account = entry.credit_account;
      balances.set(account, (balances.get(account) ?? 0) - units);
    }
  }
};

/**
 * Interest is credited on the balance that was actually sitting there, so this
 * runs as a pass over the finished stream rather than as a peer generator that
 * would have to guess. It runs last because a credit to an asset can only ever
 * raise a balance: no refill placed earlier can be invalidated by it.
 */
export const applyInterest = (ctx: SeedContext, rows: SeedRow[]): SeedRow[] => {
  const schedule = new Map<string, Bank[]>();
  for (const month of ctx.months) {
    const date = lastDayIn(month);
    if (!within(date, ctx.window)) continue;
    const due = BANKS.filter(
      (bank) =>
        bank.cadence === "monthly" || QUARTER_END_MONTHS.includes(month.month),
    );
    if (due.length > 0) schedule.set(date, due);
  }

  const dates = [...schedule.keys()].sort();
  const balances = new Map<string, number>();
  const out: SeedRow[] = [];
  let cursor = 0;

  const creditInterest = (date: string): SeedRow[] =>
    (schedule.get(date) ?? []).flatMap((bank) => {
      const balanceUnits = balances.get(bank.account) ?? 0;
      const interestUnits = Math.round(
        (balanceUnits * bank.annualRate) / PERIODS[bank.cadence],
      );
      if (interestUnits <= 0) return [];
      balances.set(bank.account, balanceUnits + interestUnits);
      return [
        row({
          date,
          description: `Interest — ${bank.name}`,
          debit: bank.account,
          credit: ACCOUNT.interestIncome,
          amount: fromUnits(interestUnits),
        }),
      ];
    });

  const flushBefore = (limit: string | undefined): void => {
    while (cursor < dates.length) {
      const due = dates[cursor];
      if (due === undefined) break;
      if (limit !== undefined && due >= limit) break;
      out.push(...creditInterest(due));
      cursor += 1;
    }
  };

  for (const seedRow of rows) {
    flushBefore(seedRow.date);
    applyRow(balances, seedRow);
    out.push(seedRow);
  }
  flushBefore(undefined);

  return out;
};
