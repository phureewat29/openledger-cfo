import { sumBy } from "es-toolkit";

import type { Life } from "../dataset";
import type { Loan } from "../products/loans";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { monthKey } from "../calendar";
import { formatMoney, fromUnits, toUnits } from "../money";
import { legsOf } from "../types";
import { check, detail } from "./shared";

interface Installment {
  date: string;
  principalUnits: number;
  interestUnits: number;
}

const installmentsOf = (rows: SeedRow[], loan: Loan): Installment[] =>
  rows
    .filter((seedRow) =>
      legsOf(seedRow).some((entry) => entry.debit_account === loan.account),
    )
    .map((seedRow) => ({
      date: seedRow.date,
      principalUnits: sumBy(
        legsOf(seedRow).filter((entry) => entry.debit_account === loan.account),
        (entry) => toUnits(entry.amount),
      ),
      interestUnits: sumBy(
        legsOf(seedRow).filter(
          (entry) => entry.debit_account === loan.interestAccount,
        ),
        (entry) => toUnits(entry.amount),
      ),
    }));

/**
 * Replays each loan against its own contract: on an amortizing loan the interest
 * charged has to be a month of the rate on what was still owed at the time, and
 * the principal is whatever is left of the payment. The replay is driven by the
 * posted rows, so a schedule that skipped, doubled or mis-split an installment
 * cannot agree with it.
 */
export const loanCheck = (life: Life, rows: SeedRow[], loan: Loan): Check => {
  const name = `${loan.label} follows its schedule`;
  const installments = installmentsOf(rows, loan);
  const prepaymentUnits = new Set(
    loan.kind === "amortizing"
      ? loan.prepayments.map((entry) => toUnits(entry.amount))
      : [],
  );

  let balanceUnits = toUnits(loan.opening);
  const faults: string[] = [];

  for (const posted of installments) {
    if (posted.principalUnits > balanceUnits) {
      faults.push(`${posted.date} repays more than is owed`);
      break;
    }

    if (loan.kind === "flat") {
      const regular = toUnits(loan.monthlyPrincipal);
      const isFinal = monthKey(posted.date) === loan.finalPaymentMonth;
      const wanted = isFinal ? balanceUnits : Math.min(regular, balanceUnits);
      if (posted.principalUnits !== wanted) {
        faults.push(
          `${posted.date} principal ${formatMoney(fromUnits(posted.principalUnits))}`,
        );
      }
      if (posted.interestUnits !== toUnits(loan.monthlyInterest)) {
        faults.push(`${posted.date} flat interest drifted`);
      }
    }

    if (loan.kind === "amortizing") {
      const isPrepayment =
        posted.interestUnits === 0 &&
        prepaymentUnits.has(posted.principalUnits);
      if (!isPrepayment) {
        const wantedInterest = Math.round(
          (balanceUnits * loan.annualRate) / 12,
        );
        const wantedPrincipal = Math.min(
          toUnits(loan.monthlyPayment) - wantedInterest,
          balanceUnits,
        );
        if (posted.interestUnits !== wantedInterest) {
          faults.push(
            `${posted.date} interest ${formatMoney(fromUnits(posted.interestUnits))} vs ${formatMoney(fromUnits(wantedInterest))}`,
          );
        }
        if (posted.principalUnits !== wantedPrincipal) {
          faults.push(
            `${posted.date} principal ${formatMoney(fromUnits(posted.principalUnits))} vs ${formatMoney(fromUnits(wantedPrincipal))}`,
          );
        }
      }
    }

    balanceUnits -= posted.principalUnits;
  }

  const tracked = toUnits(life.meta.expected.loanBalances[loan.account] ?? -1);
  if (balanceUnits !== tracked) {
    faults.push(
      `ends at ${formatMoney(fromUnits(balanceUnits))} vs tracked ${formatMoney(fromUnits(tracked))}`,
    );
  }

  return check(
    name,
    installments.length > 0 && faults.length === 0,
    detail(
      faults,
      `${String(installments.length)} installments, closes at ${formatMoney(fromUnits(balanceUnits))}`,
    ),
  );
};

export const flatLoanClosesCheck = (life: Life): Check[] =>
  life.meta.products.loans
    .filter((loan) => loan.kind === "flat")
    .map((loan) =>
      check(
        `${loan.label} settles inside the window`,
        (life.meta.expected.loanBalances[loan.account] ?? -1) === 0,
        `balance ${formatMoney(life.meta.expected.loanBalances[loan.account] ?? -1)}`,
      ),
    );
