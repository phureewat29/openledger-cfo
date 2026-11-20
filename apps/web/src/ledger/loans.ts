import { mean, sumBy } from "es-toolkit";

import { accountKindOf, segmentOf } from "./accounts";
import { MONTHS_PER_YEAR } from "./period";

// A loan's interest account is matched by a lossy name (`mortgage-condo` and
// `mortgage-house` share `interest:mortgage`); only the transaction group splits them.

/** Bounds both the histories read back and the cleared debts the page celebrates. */
export const MAX_CLOSED_LOANS = 3;

interface AccountLike {
  readonly id: string;
  readonly type: string;
}

interface LoanAccount extends AccountLike {
  readonly balance: number;
  readonly credits_posted: number;
}

/** Drawn down once and repaid to nothing. */
export const isClosedLoan = (row: LoanAccount): boolean =>
  accountKindOf(row) === "loan" && row.balance <= 0 && row.credits_posted > 0;

export const closedLoanIds = (accounts: readonly LoanAccount[]): string[] =>
  accounts
    .filter(isClosedLoan)
    .slice(0, MAX_CLOSED_LOANS)
    .map((row) => row.id);

/** The ledger's own grouping, carried through under its own name. */
interface LoanLeg {
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

/** A month's interest on its balance implies the rate; undefined, not zero, when either is missing. */
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
 * Months to zero at the principal pace the ledger has seen; undefined, not a large
 * number, when too few repayments exist to average.
 */
export const payoffProjection = (
  principalByMonth: readonly number[],
  balance: number,
): number | undefined => {
  if (balance <= 0) return undefined;
  const repaid = principalByMonth.filter((amount) => amount > 0);
  if (repaid.length < PACE_MONTHS) return undefined;
  const recent = repaid.slice(-PACE_MONTHS);
  const perMonth = mean(recent);
  if (perMonth <= 0) return undefined;
  return Math.ceil(balance / perMonth);
};
