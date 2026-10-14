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

type Faults = (posted: Installment, balanceUnits: number) => string[];

const flatFaults =
  (loan: Extract<Loan, { kind: "flat" }>): Faults =>
  (posted, balanceUnits) => {
    const regular = toUnits(loan.monthlyPrincipal);
    const isFinal = monthKey(posted.date) === loan.finalPaymentMonth;
    const wanted = isFinal ? balanceUnits : Math.min(regular, balanceUnits);
    return [
      ...(posted.principalUnits === wanted
        ? []
        : [
            `${posted.date} principal ${formatMoney(fromUnits(posted.principalUnits))}`,
          ]),
      ...(posted.interestUnits === toUnits(loan.monthlyInterest)
        ? []
        : [`${posted.date} flat interest drifted`]),
    ];
  };

const amortizingFaults = (
  loan: Extract<Loan, { kind: "amortizing" }>,
): Faults => {
  const prepaymentUnits = new Set(
    loan.prepayments.map((entry) => toUnits(entry.amount)),
  );
  return (posted, balanceUnits) => {
    const isPrepayment =
      posted.interestUnits === 0 && prepaymentUnits.has(posted.principalUnits);
    if (isPrepayment) return [];
    const wantedInterest = Math.round((balanceUnits * loan.annualRate) / 12);
    const wantedPrincipal = Math.min(
      toUnits(loan.monthlyPayment) - wantedInterest,
      balanceUnits,
    );
    return [
      ...(posted.interestUnits === wantedInterest
        ? []
        : [
            `${posted.date} interest ${formatMoney(fromUnits(posted.interestUnits))} vs ${formatMoney(fromUnits(wantedInterest))}`,
          ]),
      ...(posted.principalUnits === wantedPrincipal
        ? []
        : [
            `${posted.date} principal ${formatMoney(fromUnits(posted.principalUnits))} vs ${formatMoney(fromUnits(wantedPrincipal))}`,
          ]),
    ];
  };
};

const faultsFor = (loan: Loan): Faults =>
  loan.kind === "flat" ? flatFaults(loan) : amortizingFaults(loan);

interface Replay {
  readonly balanceUnits: number;
  readonly faults: string[];
  readonly halted: boolean;
}

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
  const faultsOf = faultsFor(loan);

  const replay = installments.reduce<Replay>(
    (state, posted) => {
      if (state.halted) return state;
      if (posted.principalUnits > state.balanceUnits) {
        return {
          ...state,
          halted: true,
          faults: [...state.faults, `${posted.date} repays more than is owed`],
        };
      }
      return {
        ...state,
        balanceUnits: state.balanceUnits - posted.principalUnits,
        faults: [...state.faults, ...faultsOf(posted, state.balanceUnits)],
      };
    },
    { balanceUnits: toUnits(loan.opening), faults: [], halted: false },
  );

  const tracked = toUnits(life.meta.expected.loanBalances[loan.account] ?? -1);
  const faults =
    replay.balanceUnits === tracked
      ? replay.faults
      : [
          ...replay.faults,
          `ends at ${formatMoney(fromUnits(replay.balanceUnits))} vs tracked ${formatMoney(fromUnits(tracked))}`,
        ];

  return check(
    name,
    installments.length > 0 && faults.length === 0,
    detail(
      faults,
      `${String(installments.length)} installments, closes at ${formatMoney(fromUnits(replay.balanceUnits))}`,
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
