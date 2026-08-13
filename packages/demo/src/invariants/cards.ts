/**
 * Every statement that fell due inside the window has to have been paid — except
 * the newest one on a card that ends mid-cycle — and the closing balance has to
 * be exactly what the charges, the interest and those payments leave behind.
 */
import type { Life } from "../dataset";
import type { Card } from "../products/cards";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { addMonths, dayIn, eachMonth, within } from "../calendar";
import { formatMoney, fromUnits, toUnits } from "../money";
import { legsOf } from "../types";
import { check, legUnits } from "./shared";

export const cardCheck = (life: Life, rows: SeedRow[], card: Card): Check => {
  const dueDates = eachMonth(life.meta.window)
    .map((month) => ({
      close: dayIn(month, card.statementDay),
      due: dayIn(addMonths(month, 1), card.dueDay),
    }))
    .filter(
      (cycle) =>
        cycle.close <= life.meta.window.end &&
        within(cycle.due, life.meta.window),
    );

  const payments = rows.filter((seedRow) =>
    legsOf(seedRow).some(
      (entry) =>
        entry.debit_account === card.account &&
        entry.credit_account === card.payFrom,
    ),
  );

  const expectedPayments =
    card.finalStatementUnpaid && dueDates.length > 0
      ? dueDates.length - 1
      : dueDates.length;

  // The opening balance and every interest posting are credits to the card, so
  // the charge total already carries both.
  const chargedUnits = legUnits(rows, "credit", card.account);
  const paidUnits = legUnits(rows, "debit", card.account);
  const closingUnits = chargedUnits - paidUnits;
  const tracked = toUnits(life.meta.expected.cardBalances[card.account] ?? -1);

  const faults = [
    payments.length === expectedPayments
      ? ""
      : `${String(payments.length)} payments for ${String(expectedPayments)} payable statements`,
    closingUnits === tracked
      ? ""
      : `closes at ${formatMoney(fromUnits(closingUnits))} vs tracked ${formatMoney(fromUnits(tracked))}`,
  ].filter(Boolean);

  return check(
    `${card.label} cycle closes`,
    faults.length === 0,
    faults.join(" · ") ||
      `${String(payments.length)} statements paid, carries ${formatMoney(fromUnits(closingUnits))}`,
  );
};

/**
 * The balance still standing when a statement closes is at least what was
 * carried past the due date, so a month of the annual rate on it is a ceiling
 * the charge can never legitimately clear.
 */
export const cardInterestCheck = (life: Life, rows: SeedRow[]): Check => {
  const rateOf = new Map(
    life.meta.products.cards.map(
      (card) => [card.account, card.annualRate] as const,
    ),
  );
  const interestAccounts = new Set(
    life.accounts
      .filter((account) => account.id.endsWith(":interest:credit-card"))
      .map((account) => account.id),
  );
  const outstanding = new Map<string, number>();
  const breaches: string[] = [];

  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      const rate = rateOf.get(entry.credit_account);
      if (interestAccounts.has(entry.debit_account) && rate !== undefined) {
        const carriedUnits = outstanding.get(entry.credit_account) ?? 0;
        const capUnits = Math.round((carriedUnits * rate) / 12) + 1;
        if (units > capUnits) {
          breaches.push(
            `${seedRow.date} ${entry.credit_account} ${formatMoney(fromUnits(units))} > ${formatMoney(fromUnits(capUnits))}`,
          );
        }
      }
      if (rateOf.has(entry.credit_account)) {
        const account = entry.credit_account;
        outstanding.set(account, (outstanding.get(account) ?? 0) + units);
      }
      if (rateOf.has(entry.debit_account)) {
        const account = entry.debit_account;
        outstanding.set(account, (outstanding.get(account) ?? 0) - units);
      }
    }
  }

  return check(
    "card interest stays under the annual-rate ceiling",
    breaches.length === 0,
    breaches.slice(0, 3).join(" · "),
  );
};
