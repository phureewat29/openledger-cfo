import { sumBy } from "es-toolkit";

import { matchesPrefix } from "./accounts";
import { monthsUntil, shiftDays } from "./period";

/**
 * `no-date` is the absence of a deadline, not a pace: a goal nobody set a date
 * for cannot be ahead of or behind one.
 */
export type PaceVerdict =
  | "done"
  | "overdue"
  | "ahead"
  | "on-track"
  | "behind"
  | "no-date";

/**
 * Money gathering toward a target, or a debt coming down to nothing. The two
 * read the prefix's balance in opposite directions, so every figure below is
 * stated as progress toward the target and the mode says which it was.
 */
export type GoalMode = "save" | "paydown";

interface GoalFacts {
  readonly id: string;
  readonly name: string;
  readonly targetAmount: number;
  readonly targetDate: string | null;
  readonly accountPrefix: string;
  readonly mode: GoalMode;
  /** Progress in money: the balance saved, or the principal already retired. */
  readonly current: number;
  /** Movement toward the target over the observation window, per month. */
  readonly observedPerMonth: number;
}

export interface GoalProgress extends GoalFacts {
  readonly progress: number;
  readonly requiredPerMonth: number | undefined;
  readonly etaMonths: number | undefined;
  readonly verdict: PaceVerdict;
}

/** A debt goal moves by being paid down, so it never reads as "adding". */
export const movementVerb = (mode: GoalMode): string =>
  mode === "paydown" ? "paying off" : "adding";

/** Past a decade the division is still exact and the date it implies is not. */
const ETA_HORIZON_MONTHS = 120;

/** One phrasing for the estimate wherever it is said, in one unit. */
export const formatEta = (months: number): string =>
  months > ETA_HORIZON_MONTHS ? "10+ yrs" : `${months} mo`;

const OBSERVATION_DAYS = 90;
const DAYS_PER_MONTH = 30;
const AHEAD = 1.1;
const ON_TRACK = 0.9;

interface BalanceRow {
  readonly id: string;
  readonly type: string;
  readonly balance: number;
}

interface MovementRow {
  readonly date: string;
  readonly debit_account_id: string;
  readonly credit_account_id: string;
  readonly amount: number;
}

interface GoalRow {
  readonly id: string;
  readonly name: string;
  /** Postgres numeric arrives as a string; the boundary is the only place to fix that. */
  readonly targetAmount: string;
  readonly targetDate: string | null;
  readonly accountPrefix: string;
}

/** What the ledger says about a prefix, before any target is held against it. */
export interface PrefixFacts {
  /** Money gathered under the prefix, or — for a debt — what is still owed. */
  readonly balance: number;
  readonly mode: GoalMode;
  /** Movement toward the prefix over the observation window, per month. */
  readonly perMonth: number;
}

/** What the window moved toward each account it touched, netted per account. */
export type NetMovement = ReadonlyMap<string, number>;

/**
 * Every prefix reads the same window, and a prefix only ever wants the accounts
 * under it, so the rows are folded onto their accounts once and each prefix
 * then sums its own share of a set the size of the chart of accounts.
 */
export const netMovement = (
  movements: readonly MovementRow[],
  today: string,
): NetMovement => {
  const since = shiftDays(today, -OBSERVATION_DAYS);
  const net = new Map<string, number>();
  const add = (account: string, amount: number) =>
    net.set(account, (net.get(account) ?? 0) + amount);

  for (const row of movements) {
    if (row.date < since) continue;
    add(row.debit_account_id, row.amount);
    add(row.credit_account_id, -row.amount);
  }
  return net;
};

/**
 * A goal prefix names either assets gathering toward a target or a debt being
 * retired, and the balance means the opposite thing in each: for assets it is
 * the progress itself, for a liability it is what is still owed, so progress is
 * the principal already paid. A debit moves both toward their target, which is
 * why one growth sum serves both. Parent accounts carry a zero balance with the
 * total on their children, which is what makes a plain prefix sum correct
 * rather than double counted.
 */
export const prefixFacts = (
  prefix: string,
  accounts: readonly BalanceRow[],
  movement: NetMovement,
): PrefixFacts => {
  const matched = accounts.filter((account) =>
    matchesPrefix(account.id, prefix),
  );
  const growth = sumBy(
    [...movement].filter(([account]) => matchesPrefix(account, prefix)),
    ([, amount]) => amount,
  );

  return {
    balance: sumBy(matched, (account) => account.balance),
    mode:
      matched.length > 0 &&
      matched.every((account) => account.type === "liability")
        ? "paydown"
        : "save",
    perMonth: growth / (OBSERVATION_DAYS / DAYS_PER_MONTH),
  };
};

/** A goal whose prefix names nothing in the ledger has no progress to report. */
const NOTHING: PrefixFacts = { balance: 0, mode: "save", perMonth: 0 };

const goalFacts = (
  goal: GoalRow,
  prefix: PrefixFacts | undefined,
): GoalFacts => {
  const facts = prefix ?? NOTHING;
  const targetAmount = Number(goal.targetAmount);
  return {
    id: goal.id,
    name: goal.name,
    targetAmount,
    targetDate: goal.targetDate,
    accountPrefix: goal.accountPrefix,
    mode: facts.mode,
    current:
      facts.mode === "paydown"
        ? Math.max(targetAmount - facts.balance, 0)
        : facts.balance,
    observedPerMonth: facts.perMonth,
  };
};

const verdictFor = (
  remaining: number,
  requiredPerMonth: number | undefined,
  observedPerMonth: number,
  overdue: boolean,
): PaceVerdict => {
  if (remaining <= 0) return "done";
  if (overdue) return "overdue";
  if (requiredPerMonth === undefined) return "no-date";
  if (observedPerMonth >= requiredPerMonth * AHEAD) return "ahead";
  if (observedPerMonth >= requiredPerMonth * ON_TRACK) return "on-track";
  return "behind";
};

const computeGoal = (facts: GoalFacts, today: string): GoalProgress => {
  const remaining = Math.max(facts.targetAmount - facts.current, 0);
  const progress =
    facts.targetAmount > 0
      ? Math.min(facts.current / facts.targetAmount, 1)
      : 0;
  const monthsLeft = facts.targetDate
    ? monthsUntil(today, facts.targetDate)
    : undefined;
  const overdue =
    facts.targetDate !== null && facts.targetDate < today && remaining > 0;
  const requiredPerMonth =
    monthsLeft === undefined ? undefined : remaining / Math.max(monthsLeft, 1);
  const etaMonths =
    facts.observedPerMonth > 0
      ? Math.ceil(remaining / facts.observedPerMonth)
      : undefined;

  return {
    ...facts,
    progress,
    requiredPerMonth,
    etaMonths,
    verdict: verdictFor(
      remaining,
      requiredPerMonth,
      facts.observedPerMonth,
      overdue,
    ),
  };
};

/**
 * Contributions are observed from where the ledger's data ends, which is what
 * `facts` was measured against; deadlines are real dates, so `today` decides
 * whether one has passed.
 */
export const goalProgress = (
  goals: readonly GoalRow[],
  facts: Readonly<Record<string, PrefixFacts>>,
  today: string,
): GoalProgress[] =>
  goals.map((goal) =>
    computeGoal(goalFacts(goal, facts[goal.accountPrefix]), today),
  );
