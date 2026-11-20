import { cache } from "react";
import { groupBy, mapValues, orderBy, union } from "es-toolkit";

import type { RouterOutputs } from "@openledger-cfo/api";
import { caller } from "@openledger-cfo/api";

import type { Baseline } from "~/flows/types";
import type { Insight, RuleInput } from "~/insights/types";
import type { AccountRow } from "~/ledger/accounts";
import type { LedgerLoad } from "~/ledger/load";
import type { TransactionRow } from "~/ledger/postings";
import type { Point } from "~/lib/charts/data";
import type { PrefixFacts } from "~/plan/goals";
import type { UpcomingItem } from "~/plan/upcoming";
import { splitPortfolio } from "~/accounts/portfolio";
import { toBaseline } from "~/flows/flow";
import { runInsights } from "~/insights/rules";
import { selectRuleInput } from "~/insights/select";
import {
  headOf,
  isMoneyCurrency,
  matchesPrefix,
  PRIMARY,
  unitCurrencies,
} from "~/ledger/accounts";
import { weeklyBalance } from "~/ledger/history";
import { asLedgerLoad, ledgerHead } from "~/ledger/load";
import { MAX_CLOSED_LOANS } from "~/ledger/loans";
import { netWorthSeries, TRAJECTORY_MONTHS } from "~/ledger/net-worth";
import {
  asOfFor,
  firstDayOf,
  isoToday,
  isStale,
  latestOf,
  monthOf,
  shiftDays,
  shiftMonth,
  windowOf,
} from "~/ledger/period";
import { toPostings } from "~/ledger/postings";
import { accountLabel } from "~/lib/format";
import { monthToDateSpend } from "~/plan/budgets";
import { netMovement, prefixFacts } from "~/plan/goals";
import { ledgerUpcoming } from "~/plan/upcoming";

/** Wide enough to be "everything"; `report` echoes back the range it used. */
const LEDGER_EPOCH = "2000-01-01";
const LATEST_ROWS = 15;
/** Half a year of weekly samples: as much shape as a 60px line can carry. */
const SPARK_WEEKS = 24;
/** Every top-level spending category hangs directly off this account. */
const EXPENSE_ROOT = `${PRIMARY}:expense`;

export interface PrefixOption {
  readonly value: string;
  readonly label: string;
}

export interface Dashboard {
  readonly today: string;
  /** True when the ledger's newest activity is not in the current month. */
  readonly stale: boolean;
  readonly input: RuleInput;
  readonly insights: readonly Insight[];
  readonly insightState: Record<
    string,
    { status: string; note: string | null }
  >;
  readonly lifetime: { readonly income: number; readonly expenses: number };
  readonly prefixOptions: readonly PrefixOption[];
  /**
   * What the ledger says about every prefix a goal can name, offered or
   * already claimed. Adding or dropping a goal moves none of it, so goals
   * re-derive from this without re-reading the ledger.
   */
  readonly prefixFacts: Readonly<Record<string, PrefixFacts>>;
  readonly goalRows: RouterOutputs["goals"]["list"];
  /** Top-level spending categories, for setting a budget against one. */
  readonly budgetOptions: readonly PrefixOption[];
  readonly budgetLimits: RouterOutputs["budgets"]["list"];
  /** Month-to-date spend per category, budgeted or not. */
  readonly categorySpend: Readonly<Record<string, number>>;
  /** The share of the current month already gone, which pacing divides by. */
  readonly monthElapsed: number;
  readonly baseline: Baseline;
  /** Net worth at each month end, oldest first. */
  readonly trajectory: readonly Point[];
  /** Everything the ledger schedules; reminders merge in beside it. */
  readonly upcomingLedger: readonly UpcomingItem[];
  readonly reminders: RouterOutputs["reminders"]["list"];
  /** Newest rows in the window, newest first. */
  readonly latest: readonly TransactionRow[];
  /**
   * Leaves only: a parent carries no balance of its own. The unit ledgers ride
   * along because a position's quantity is only reachable through them; every
   * consumer that sums money drops them first.
   */
  readonly accounts: readonly AccountRow[];
  /** Account id to the newest date it moved inside the window. */
  readonly activity: Readonly<Record<string, string | undefined>>;
  /**
   * Recent weekly balances per bank leaf, for the shape beside each row. It is
   * a fold over rows this page already holds, so it costs no ledger read.
   */
  readonly sparks: Readonly<Record<string, readonly Point[]>>;
}

const isAssetPrefix = (id: string, parentIds: ReadonlySet<string>) => {
  if (!matchesPrefix(id, `${PRIMARY}:asset`)) return false;
  const depth = id.split(":").length;
  // Leaves hold the balances; three-segment parents give useful "all of X" goals.
  return depth === 4 || (depth === 3 && parentIds.has(id));
};

/**
 * A group whose auto-title-cased name collides with its only child is a
 * redundant dropdown entry — drop the group, keep the leaf. Multiple children
 * keep the group, labeled "All X" instead.
 */
const groupLabel = (
  groupName: string,
  children: readonly { readonly name: string }[],
): string | undefined => {
  if (children.length === 1 && children[0]?.name === groupName) {
    return undefined;
  }
  return children.length > 1 ? `All ${groupName}` : groupName;
};

/**
 * The window's rows re-filed under each account they touch, in one walk. A
 * replay only makes sense against one account's own legs, and re-scanning
 * every row per account is the same walk done once per bank.
 */
const rowsByAccount = (
  rows: readonly TransactionRow[],
): Record<string, TransactionRow[]> =>
  mapValues(
    groupBy(
      rows.flatMap((row) => [
        { account: row.debit_account_id, row },
        { account: row.credit_account_id, row },
      ]),
      (leg) => leg.account,
    ),
    (legs) => legs.map((leg) => leg.row),
  );

/** Newest date each account moved, which is what makes a dormant account visible. */
const lastActivity = (
  byAccount: Readonly<Record<string, readonly TransactionRow[]>>,
): Record<string, string | undefined> =>
  mapValues(byAccount, (rows) => latestOf(rows.map((row) => row.date)));

export const loadDashboard = cache((): Promise<LedgerLoad<Dashboard>> =>
  asLedgerLoad(buildDashboard()),
);

const buildDashboard = async (): Promise<Dashboard> => {
  const today = isoToday();

  // The newest row decides where the trailing windows end, so it is read first.
  const [{ status, newest }, accounts] = await Promise.all([
    ledgerHead(),
    caller.ledger.accounts.list(),
  ]);
  const asOf = asOfFor(newest, today);
  // The one trailing window every figure on this page is measured over.
  const windowStart = windowOf(asOf).from;

  const [
    allTransactions,
    allEarlier,
    goalRows,
    stateRows,
    lifetime,
    budgets,
    reminders,
  ] = await Promise.all([
    caller.ledger.transactions.listAll({ from: windowStart, to: asOf }),
    // The trajectory reaches back further than anything else on the page, so it
    // reads only the months the shared window does not already cover.
    caller.ledger.transactions.listAll({
      from: firstDayOf(shiftMonth(monthOf(asOf), -TRAJECTORY_MONTHS)),
      to: shiftDays(windowStart, -1),
    }),
    caller.goals.list(),
    caller.insights.list(),
    caller.ledger.report({ from: LEDGER_EPOCH, to: today }),
    caller.budgets.list(),
    caller.reminders.list(),
  ]);

  // A quantity is not money: the unit ledgers balance in shares and coins, so
  // their legs are dropped before anything on this page adds a figure up.
  const units = unitCurrencies(accounts.rows);
  const isMoneyRow = (row: TransactionRow): boolean =>
    isMoneyCurrency(row.currency, units) &&
    isMoneyCurrency(headOf(row.debit_account_id), units);
  const transactions = allTransactions.filter(isMoneyRow);
  const earlier = allEarlier.filter(isMoneyRow);

  // Loans already cleared were repaid before the window opened.
  const closedLoanIds = accounts.rows
    .filter(
      (row) =>
        row.type === "liability" &&
        row.id.includes(":loan:") &&
        row.balance <= 0 &&
        row.credits_posted > 0,
    )
    .slice(0, MAX_CLOSED_LOANS)
    .map((row) => row.id);
  const histories = await Promise.all(
    closedLoanIds.map((account) =>
      caller.ledger.transactions.listAll({ account }),
    ),
  );

  const input = selectRuleInput({
    today,
    asOf,
    status,
    accounts: accounts.rows,
    transactions,
    closedLoanHistory: histories.flat(),
  });

  const parentIds = new Set(
    accounts.rows
      .map((row) => row.parent_id)
      .filter((id): id is string => id !== null),
  );
  const childrenByParent = groupBy(accounts.rows, (row) => row.parent_id ?? "");
  const leaves = accounts.rows.filter((row) => !parentIds.has(row.id));
  const moneyLeaves = leaves.filter((row) =>
    isMoneyCurrency(row.currency, units),
  );

  const postings = toPostings(transactions);
  const baseline = toBaseline(transactions, asOf);

  const budgetable = accounts.rows.filter(
    (row) => row.type === "expense" && row.parent_id === EXPENSE_ROOT,
  );
  // A limit set against a category outside the picker still has to be measured.
  const categorySpend = Object.fromEntries(
    union(
      budgetable.map((row) => row.id),
      budgets.map((row) => row.category),
    ).map((category) => [
      category,
      monthToDateSpend(postings, category, input.month, input.dayOfMonth),
    ]),
  );
  const budgeted = new Set(budgets.map((budget) => budget.category));
  /**
   * Ranked by what each category already cost this month, un-budgeted first,
   * so the budget picker defaults to the largest one still worth a limit.
   * Labeled the same way the budget rows are, so picker and row agree.
   */
  const budgetOptions = orderBy(
    budgetable.map((row) => ({ value: row.id, label: accountLabel(row.id) })),
    [
      (option) => budgeted.has(option.value),
      (option) => categorySpend[option.value] ?? 0,
    ],
    ["asc", "desc"],
  );

  const prefixOptions = accounts.rows
    .filter((row) => row.type === "asset" && isAssetPrefix(row.id, parentIds))
    .map((row): PrefixOption | undefined => {
      const isGroup = row.id.split(":").length === 3;
      if (!isGroup) return { value: row.id, label: row.name };
      const label = groupLabel(row.name, childrenByParent[row.id] ?? []);
      return label === undefined ? undefined : { value: row.id, label };
    })
    .filter((option): option is PrefixOption => option !== undefined);

  const byAccount = rowsByAccount(transactions);
  const sparks = Object.fromEntries(
    splitPortfolio(leaves).banks.map((row) => [
      row.id,
      weeklyBalance(
        byAccount[row.id] ?? [],
        row.id,
        asOf,
        row.balance,
        SPARK_WEEKS,
      ),
    ]),
  );

  // A goal already pointed at a debt names a prefix the picker never offers.
  const movement = netMovement(transactions, asOf);
  const facts = Object.fromEntries(
    union(
      prefixOptions.map((option) => option.value),
      goalRows.map((row) => row.accountPrefix),
    ).map((prefix) => [prefix, prefixFacts(prefix, accounts.rows, movement)]),
  );

  return {
    today,
    stale: isStale(asOf, today),
    input,
    insights: runInsights(input),
    insightState: Object.fromEntries(
      stateRows.map((row) => [
        row.insightId,
        { status: row.status, note: row.note },
      ]),
    ),
    lifetime: {
      income: lifetime.income.THB ?? 0,
      expenses: lifetime.expenses.THB ?? 0,
    },
    prefixOptions,
    prefixFacts: facts,
    goalRows,
    budgetOptions,
    budgetLimits: budgets,
    categorySpend,
    monthElapsed:
      input.daysInMonth > 0 ? input.dayOfMonth / input.daysInMonth : 0,
    baseline,
    trajectory: netWorthSeries(
      [...earlier, ...transactions],
      monthOf(asOf),
      input.netWorthThb,
    ),
    upcomingLedger: ledgerUpcoming({ accounts: moneyLeaves, postings, today }),
    reminders,
    // `transactions list` answers newest first; the sort keeps that true of a merged page set.
    latest: transactions
      .toSorted((left, right) => right.date.localeCompare(left.date))
      .slice(0, LATEST_ROWS),
    accounts: leaves,
    activity: lastActivity(byAccount),
    sparks,
  };
};
