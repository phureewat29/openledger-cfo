import { sumBy } from "es-toolkit";

import type { Card } from "../products/cards";
import type { SeedContext, SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
import { addMonths, dayIn, monthKey, within } from "../calendar";
import { fromUnits, toUnits } from "../money";
import { CARDS } from "../products/cards";
import { legsOf, row } from "../rows";

interface Charge {
  date: string;
  units: number;
}

interface CardsResult {
  rows: SeedRow[];
  endBalances: Record<string, number>;
}

const chargesFor = (rows: SeedRow[], account: string): Charge[] =>
  rows.flatMap((seedRow) =>
    legsOf(seedRow)
      .filter((entry) => entry.credit_account === account)
      .map((entry) => ({ date: seedRow.date, units: toUnits(entry.amount) })),
  );

const lastDueInWindow = (ctx: SeedContext, card: Card): string =>
  ctx.months
    .filter((month) => dayIn(month, card.statementDay) <= ctx.window.end)
    .map((month) => dayIn(addMonths(month, 1), card.dueDay))
    .filter((dueDate) => within(dueDate, ctx.window))
    .at(-1) ?? "";

/** The opening balance is dated day one, inside the first statement, so it accrues no interest. */
const cycleRows = (
  ctx: SeedContext,
  card: Card,
  charges: Charge[],
): SeedRow[] => {
  const rows: SeedRow[] = [];
  let previousClose = "";
  let carriedUnits = 0;
  const unpaidDue = card.finalStatementUnpaid ? lastDueInWindow(ctx, card) : "";

  for (const month of ctx.months) {
    const closeDate = dayIn(month, card.statementDay);
    if (closeDate > ctx.window.end) break;

    const cycleUnits = sumBy(
      charges.filter(
        (charge) => charge.date > previousClose && charge.date <= closeDate,
      ),
      (charge) => charge.units,
    );
    previousClose = closeDate;

    const accruedUnits =
      carriedUnits > 0 ? Math.round((carriedUnits * card.annualRate) / 12) : 0;
    if (accruedUnits > 0) {
      rows.push(
        row({
          date: closeDate,
          description: `Credit card interest — ${card.label}`,
          debit: ACCOUNT.cardInterest,
          credit: card.account,
          amount: fromUnits(accruedUnits),
        }),
      );
    }

    const statementUnits = carriedUnits + accruedUnits + cycleUnits;
    if (statementUnits <= 0) {
      carriedUnits = 0;
      continue;
    }

    const dueDate = dayIn(addMonths(month, 1), card.dueDay);
    if (!within(dueDate, ctx.window) || dueDate === unpaidDue) {
      carriedUnits = statementUnits;
      continue;
    }

    const partial = card.partialPaymentMonths.includes(monthKey(dueDate));
    const payUnits = partial
      ? Math.round(statementUnits * card.partialFraction)
      : statementUnits;

    rows.push(
      row({
        date: dueDate,
        description: partial
          ? `${card.label} — partial payment`
          : `${card.label} — statement payment`,
        debit: card.account,
        credit: card.payFrom,
        amount: fromUnits(payUnits),
      }),
    );
    carriedUnits = statementUnits - payUnits;
  }

  return rows;
};

const balanceOf = (card: Card, charges: Charge[], cycle: SeedRow[]): number => {
  const interestUnits = sumBy(cycle, (seedRow) =>
    sumBy(
      legsOf(seedRow).filter((entry) => entry.credit_account === card.account),
      (entry) => toUnits(entry.amount),
    ),
  );
  const paidUnits = sumBy(cycle, (seedRow) =>
    sumBy(
      legsOf(seedRow).filter((entry) => entry.debit_account === card.account),
      (entry) => toUnits(entry.amount),
    ),
  );
  const chargedUnits = sumBy(charges, (charge) => charge.units);
  return fromUnits(chargedUnits + interestUnits - paidUnits);
};

export const generateCards = (
  ctx: SeedContext,
  priorRows: SeedRow[],
): CardsResult => {
  const cycles = CARDS.map((card) => {
    const charges = chargesFor(priorRows, card.account);
    const rows = cycleRows(ctx, card, charges);
    return { card, rows, balance: balanceOf(card, charges, rows) };
  });

  return {
    rows: cycles.flatMap((entry) => entry.rows),
    endBalances: Object.fromEntries(
      cycles.map((entry) => [entry.card.account, entry.balance]),
    ),
  };
};
