import { groupBy, sumBy, union } from "es-toolkit";

import { matchesPrefix, PRIMARY } from "~/ledger/accounts";
import { monthsUntil, shiftDays } from "~/ledger/period";

/** One entry of a goal or budget picker. */
export interface PrefixOption {
  readonly value: string;
  readonly label: string;
}

/**
 * `no-date` is the absence of a deadline, not a pace: a goal nobody set a date
 * for cannot be ahead of or behind one.
 */
export type PaceVerdict =
  "done" | "overdue" | "ahead" | "on-track" | "behind" | "no-date";

/** Saving reads a prefix's balance as progress, paying down as what is left: figures below are progress either way. */
type GoalMode = "save" | "paydown";

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
  /** The control plane stores money as text on purpose (db schema); the boundary is the only place to widen it. */
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
type NetMovement = ReadonlyMap<string, number>;

/** Folded onto accounts once, so each prefix sums a set the size of the chart of accounts. */
const netMovement = (
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
 * Assets hold progress itself, a liability what is still owed. Parents carry
 * zero balance, so a prefix sum is never double-counted.
 */
const prefixFacts = (
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

interface PrefixAccount extends BalanceRow {
  readonly name: string;
  readonly parent_id: string | null;
}

/** A group whose title-cased name repeats its only child's adds nothing; several children read "All X". */
const groupLabel = (
  groupName: string,
  children: readonly { readonly name: string }[],
): string | undefined => {
  if (children.length === 1 && children[0]?.name === groupName) {
    return undefined;
  }
  return children.length > 1 ? `All ${groupName}` : groupName;
};

/** Every asset leaf, plus each three-segment parent worth an "all of X" goal. */
export const goalPrefixOptions = (
  accounts: readonly PrefixAccount[],
): PrefixOption[] => {
  const childrenByParent = groupBy(accounts, (row) => row.parent_id ?? "");
  const isAssetPrefix = (id: string) => {
    if (!matchesPrefix(id, `${PRIMARY}:asset`)) return false;
    const depth = id.split(":").length;
    return depth === 4 || (depth === 3 && childrenByParent[id] !== undefined);
  };

  return accounts
    .filter((row) => row.type === "asset" && isAssetPrefix(row.id))
    .flatMap((row): PrefixOption[] => {
      const isGroup = row.id.split(":").length === 3;
      if (!isGroup) return [{ value: row.id, label: row.name }];
      const label = groupLabel(row.name, childrenByParent[row.id] ?? []);
      return label === undefined ? [] : [{ value: row.id, label }];
    });
};

/**
 * Facts for every prefix a goal can name, offered or already claimed: a goal
 * on a debt names one the picker never offers. Adding a goal moves none of it.
 */
export const goalPrefixFacts = ({
  options,
  goals,
  accounts,
  movements,
  asOf,
}: {
  readonly options: readonly PrefixOption[];
  readonly goals: readonly { readonly accountPrefix: string }[];
  readonly accounts: readonly BalanceRow[];
  readonly movements: readonly MovementRow[];
  readonly asOf: string;
}): Record<string, PrefixFacts> => {
  const movement = netMovement(movements, asOf);
  return Object.fromEntries(
    union(
      options.map((option) => option.value),
      goals.map((goal) => goal.accountPrefix),
    ).map((prefix) => [prefix, prefixFacts(prefix, accounts, movement)]),
  );
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

/** Pace is observed where the ledger ends, as `facts` was; deadlines are real dates, judged against `today`. */
export const goalProgress = (
  goals: readonly GoalRow[],
  facts: Readonly<Record<string, PrefixFacts>>,
  today: string,
): GoalProgress[] =>
  goals.map((goal) =>
    computeGoal(goalFacts(goal, facts[goal.accountPrefix]), today),
  );
