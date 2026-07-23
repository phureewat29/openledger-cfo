import type { AmortizingLoan, FlatLoan, Loan } from "../products/loans";
import type { SeedContext, SeedRow } from "../types";
import { dayIn, monthKey, onOrAfterBusinessDay, within } from "../calendar";
import { fromUnits, toUnits } from "../money";
import { LOANS } from "../products/loans";
import { leg, linked, row } from "../types";

interface LoansResult {
  rows: SeedRow[];
  /** What each loan still owes at the window's close, tracked by the schedule itself. */
  terminalBalances: Record<string, number>;
}

interface Schedule {
  rows: SeedRow[];
  balance: number;
}

/**
 * An installment always clears the contractual payment, so the two legs share
 * one credit and are written as a group. Once the remaining principal is smaller
 * than the payment the interest leg can round away entirely, and a group of one
 * leg is just a transaction.
 */
const installment = (input: {
  date: string;
  description: string;
  loan: Loan;
  principalUnits: number;
  interestUnits: number;
}): SeedRow => {
  if (input.interestUnits <= 0) {
    return row({
      date: input.date,
      description: input.description,
      debit: input.loan.account,
      credit: input.loan.payFrom,
      amount: fromUnits(input.principalUnits),
    });
  }
  return linked({
    date: input.date,
    description: input.description,
    legs: [
      leg(
        input.loan.account,
        input.loan.payFrom,
        fromUnits(input.principalUnits),
      ),
      leg(
        input.loan.interestAccount,
        input.loan.payFrom,
        fromUnits(input.interestUnits),
      ),
    ],
  });
};

const amortizingSchedule = (
  ctx: SeedContext,
  loan: AmortizingLoan,
): Schedule => {
  const rows: SeedRow[] = [];
  const paymentUnits = toUnits(loan.monthlyPayment);
  let balanceUnits = toUnits(loan.opening);

  for (const month of ctx.months) {
    const key = monthKey(dayIn(month, 1));
    const dueDate = onOrAfterBusinessDay(dayIn(month, loan.paymentDay));

    if (within(dueDate, ctx.window) && balanceUnits > 0) {
      const interestUnits = Math.round((balanceUnits * loan.annualRate) / 12);
      const principalUnits = Math.min(
        paymentUnits - interestUnits,
        balanceUnits,
      );
      balanceUnits -= principalUnits;
      rows.push(
        installment({
          date: dueDate,
          description: `${loan.label} — ${balanceUnits === 0 ? "final installment" : "monthly installment"}`,
          loan,
          principalUnits,
          interestUnits,
        }),
      );
    }

    for (const prepayment of loan.prepayments) {
      if (prepayment.month !== key || balanceUnits <= 0) continue;
      const date = onOrAfterBusinessDay(dayIn(month, prepayment.day));
      if (!within(date, ctx.window)) continue;
      const amountUnits = Math.min(toUnits(prepayment.amount), balanceUnits);
      balanceUnits -= amountUnits;
      rows.push(
        row({
          date,
          description: `${loan.label} — lump-sum prepayment`,
          debit: loan.account,
          credit: prepayment.payFrom,
          amount: fromUnits(amountUnits),
        }),
      );
    }
  }

  return { rows, balance: fromUnits(balanceUnits) };
};

const flatSchedule = (ctx: SeedContext, loan: FlatLoan): Schedule => {
  const rows: SeedRow[] = [];
  const interestUnits = toUnits(loan.monthlyInterest);
  let balanceUnits = toUnits(loan.opening);
  let number = loan.installmentsPaid;

  for (const month of ctx.months) {
    const key = monthKey(dayIn(month, 1));
    if (key > loan.finalPaymentMonth) break;
    const dueDate = onOrAfterBusinessDay(dayIn(month, loan.paymentDay));
    if (!within(dueDate, ctx.window)) continue;

    const isFinal = key === loan.finalPaymentMonth;
    const principalUnits = isFinal
      ? balanceUnits
      : Math.min(toUnits(loan.monthlyPrincipal), balanceUnits);
    if (principalUnits <= 0) break;
    balanceUnits -= principalUnits;
    number += 1;

    rows.push(
      installment({
        date: dueDate,
        description: `${loan.label} — installment ${String(number)}/${String(loan.termMonths)}${isFinal ? " (final)" : ""}`,
        loan,
        principalUnits,
        interestUnits,
      }),
    );
  }

  return { rows, balance: fromUnits(balanceUnits) };
};

const scheduleOf = (ctx: SeedContext, loan: Loan): Schedule =>
  loan.kind === "amortizing"
    ? amortizingSchedule(ctx, loan)
    : flatSchedule(ctx, loan);

export const generateLoans = (ctx: SeedContext): LoansResult => {
  const schedules = LOANS.map((loan) => ({
    loan,
    schedule: scheduleOf(ctx, loan),
  }));

  return {
    rows: schedules.flatMap((entry) => entry.schedule.rows),
    terminalBalances: Object.fromEntries(
      schedules.map((entry) => [entry.loan.account, entry.schedule.balance]),
    ),
  };
};
