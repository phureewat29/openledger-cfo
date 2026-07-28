import { sumBy } from "es-toolkit";

import { MONTHS_PER_YEAR } from "./period";
import { segmentOf } from "./postings";

/**
 * A loan is tied to the expense account holding its interest by name alone, and
 * the name is lossy: `loan:mortgage-condo` and `loan:mortgage-house` both answer
 * to `expense:interest:mortgage`. The installment posts principal and interest
 * as one transaction group, and the interest leg never touches the loan account,
 * so the group is the only thing that tells two loans in a family apart.
 */

/**
 * How many settled loans stay in view — it bounds both the histories read back
 * out of the ledger and the debts the page congratulates you for clearing.
 * Past this the page is reminiscing rather than reporting.
 */
export const MAX_CLOSED_LOANS = 3;

interface AccountLike {
  readonly id: string;
  readonly type: string;
}

/** The ledger's own grouping, carried through under its own name. */
export interface LoanLeg {
  readonly group_id: string | null;
  readonly amount: number;
}

const lastSegment = (id: string) => id.slice(id.lastIndexOf(":") + 1);

/** Exact leaf first, then the family head — `mortgage-condo` falls back to `mortgage`. */
export const interestAccountFor = (
  loanId: string,
  accounts: readonly AccountLike[],
): string | undefined => {
  const leaf = lastSegment(loanId);
  const family = leaf.split("-")[0] ?? leaf;
  const prefix = `${segmentOf(loanId, 0)}:expense:interest:`;
  const candidates = accounts.filter(
    (account) => account.type === "expense" && account.id.startsWith(prefix),
  );
  return (
    candidates.find((account) => account.id.endsWith(`:${leaf}`)) ??
    candidates.find((account) => account.id.endsWith(`:${family}`))
  )?.id;
};

/** Interest charged on this loan alone: the shared account, split by group. */
export const interestLegsFor = <Leg extends LoanLeg>(
  loanLegs: readonly LoanLeg[],
  interestLegs: readonly Leg[],
): Leg[] => {
  const groups = new Set(
    loanLegs.flatMap((leg) => (leg.group_id === null ? [] : [leg.group_id])),
  );
  return interestLegs.filter(
    (leg) => leg.group_id !== null && groups.has(leg.group_id),
  );
};

export const interestPaidFor = (
  loanLegs: readonly LoanLeg[],
  interestLegs: readonly LoanLeg[],
): number =>
  sumBy(interestLegsFor(loanLegs, interestLegs), (leg) => leg.amount);

/**
 * The lender's rate is never in the ledger, but a month's interest on the
 * balance it was charged against implies one. Undefined rather than zero when
 * either side is missing: a rate the ledger cannot defend is not a rate.
 */
export const impliedAprOf = (
  monthlyInterest: number,
  balance: number,
): number | undefined =>
  balance > 0 && monthlyInterest > 0
    ? (monthlyInterest / balance) * MONTHS_PER_YEAR
    : undefined;

/** Fewer repayments than this is an anecdote, not a pace. */
const PACE_MONTHS = 3;

/**
 * Months to zero at the pace the ledger has actually seen. Only principal
 * moves a loan balance, so the recent months that carry any are both the
 * evidence that it is falling and the rate it falls at. Undefined rather than
 * a large number when there is too little to average: a date the ledger cannot
 * defend is not a date.
 */
export const payoffProjection = (
  principalByMonth: readonly number[],
  balance: number,
): number | undefined => {
  if (balance <= 0) return undefined;
  const repaid = principalByMonth.filter((amount) => amount > 0);
  if (repaid.length < PACE_MONTHS) return undefined;
  const recent = repaid.slice(-PACE_MONTHS);
  const perMonth = sumBy(recent, (amount) => amount) / recent.length;
  if (perMonth <= 0) return undefined;
  return Math.ceil(balance / perMonth);
};
