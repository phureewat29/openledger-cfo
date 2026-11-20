import { groupBy, orderBy, sortBy, sumBy } from "es-toolkit";

import type { PositionTrade } from "~/accounts/portfolio";
import type { FlowGraph } from "~/flows/flow";
import type { AccountKind, AccountRow } from "~/ledger/accounts";
import type { TransactionRow } from "~/ledger/postings";
import type { BarSeries, CategoryTotal, Point } from "~/lib/charts/data";
import {
  averageCost,
  repaidShare,
  tradesOf,
  unitPositionOf,
} from "~/accounts/portfolio";
import { toAccountFlow } from "~/flows/flow";
import {
  accountKindOf,
  accountLabel,
  categoryOf,
  segmentOf,
} from "~/ledger/accounts";
import {
  balanceMonthKeys,
  monthlyBalance,
  weeklyBalance,
} from "~/ledger/history";
import {
  impliedAprOf,
  interestLegsFor,
  payoffProjection,
} from "~/ledger/loans";
import {
  asOfFor,
  clampDay,
  dayOf,
  firstDayOf,
  latestOf,
  monthOf,
  monthsThrough,
  shiftDays,
  shiftMonth,
  windowOf,
} from "~/ledger/period";
import { formatMonthAbbr, formatMonthYear } from "~/lib/format";

/** What each kind of account is worth plotting. */
export type AccountSeries =
  | {
      readonly kind: "card";
      readonly months: readonly string[];
      readonly categories: readonly BarSeries[];
      readonly cycle: readonly CategoryTotal[];
    }
  | {
      readonly kind: "loan";
      readonly months: readonly string[];
      readonly principal: readonly number[];
      readonly interest: readonly number[];
      readonly balance: readonly Point[];
    }
  | { readonly kind: "cash"; readonly balance: readonly Point[] }
  | {
      readonly kind: "position";
      readonly basis: readonly Point[];
      /** Indices into `basis` whose month the position was bought in. */
      readonly buyPoints: readonly number[];
    }
  | { readonly kind: "basic" };

export interface MonthFlow {
  readonly month: string;
  readonly in: number;
  readonly out: number;
}

/** The header's cells beside the balance; none repeats it, each says what the page does not. */
export type AccountMeta =
  | {
      readonly kind: "card";
      /** The newest payment funded from an asset account; undefined when there has been none. */
      readonly lastPayment:
        { readonly amount: number; readonly date: string } | undefined;
      /** The day the open statement cycle began, which is what dates the spend. */
      readonly cycleFrom: string;
      readonly statementDay: number | null;
      readonly dueDay: number | null;
    }
  | {
      readonly kind: "loan";
      readonly original: number;
      readonly paid: number;
      readonly progress: number;
      readonly interestPaid: number;
      /** Undefined when a month's interest or the balance is missing. */
      readonly impliedApr: number | undefined;
    }
  | {
      readonly kind: "cash";
      readonly interestEarned: number;
      readonly year: string;
      readonly lastActivity: string | undefined;
      readonly received: number;
      readonly sent: number;
    }
  | {
      readonly kind: "position";
      /** Buys inside the plotted window, so the count matches the columns. */
      readonly buys: number;
      readonly lastBuy: string | undefined;
      readonly invested12m: number;
      readonly avgMonthly: number;
      /** Undefined for a position the ledger counts in money only. */
      readonly shares: number | undefined;
      readonly avgCost: number | undefined;
      readonly lastTrade: PositionTrade | undefined;
    }
  | {
      readonly kind: "basic";
      readonly totalIn: number;
      readonly totalOut: number;
      readonly transactions: number;
      readonly lastActivity: string | undefined;
    };

export interface AccountView {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly subtype: string | null;
  readonly currency: string;
  readonly balance: number;
  readonly asOf: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly flow: FlowGraph | null;
  readonly monthly: readonly MonthFlow[];
  readonly meta: AccountMeta;
  readonly series: AccountSeries;
}

interface MetaInput {
  readonly row: AccountRow;
  readonly rows: readonly TransactionRow[];
  readonly accounts: readonly AccountRow[];
  readonly asOf: string;
  /** Complete months only — what a month-end level or an average is measured over. */
  readonly months: readonly string[];
  /** The same span through `asOf`'s own month — what a column of totals covers. */
  readonly axis: readonly string[];
  /** This loan's own interest legs, already split out of the shared account. */
  readonly interest: readonly TransactionRow[];
  /** This position's own unit legs, which is where its quantity lives. */
  readonly units: readonly TransactionRow[];
}

const lastDateOf = (rows: readonly TransactionRow[]) =>
  latestOf(rows.map((row) => row.date));

const debits = (rows: readonly TransactionRow[], id: string) =>
  rows.filter((row) => row.debit_account_id === id);

const credits = (rows: readonly TransactionRow[], id: string) =>
  rows.filter((row) => row.credit_account_id === id);

const amountOf = (rows: readonly TransactionRow[]) =>
  sumBy(rows, (row) => row.amount);

const inMonth = (rows: readonly TransactionRow[], month: string) =>
  rows.filter((row) => monthOf(row.date) === month);

const TOP_CATEGORIES = 5;

/** A card purchase credits the card and debits whatever it paid for. */
const spendLegs = (rows: readonly TransactionRow[], cardId: string) =>
  credits(rows, cardId);

const rankedCategories = (rows: readonly TransactionRow[]) =>
  orderBy(
    Object.entries(groupBy(rows, (row) => categoryOf(row.debit_account_id))),
    [([, group]) => amountOf(group)],
    ["desc"],
  );

/** Every category the card paid, for the caller to rank and fold. */
const cardCategories = (
  rows: readonly TransactionRow[],
  cardId: string,
  from: string,
): CategoryTotal[] =>
  rankedCategories(
    spendLegs(rows, cardId).filter((row) => row.date > from),
  ).map(([key, group]) => ({
    key,
    label: accountLabel(key),
    value: amountOf(group),
  }));

/** Ranked over the whole window, never per month, so a band keeps its tone across columns. */
const cardSpend = (
  rows: readonly TransactionRow[],
  cardId: string,
  months: readonly string[],
): BarSeries[] => {
  const covered = new Set(months);
  const legs = spendLegs(rows, cardId).filter((row) =>
    covered.has(monthOf(row.date)),
  );
  const ranked = rankedCategories(legs);
  const valuesOf = (group: readonly TransactionRow[]) =>
    months.map((month) => amountOf(inMonth(group, month)));

  const top = ranked
    .slice(0, TOP_CATEGORIES)
    .map(([key, group]): BarSeries => ({
      key,
      label: accountLabel(key),
      values: valuesOf(group),
    }));
  const rest = ranked.slice(TOP_CATEGORIES).flatMap(([, group]) => group);
  if (rest.length === 0) return top;
  return [...top, { key: "other", label: "Other", values: valuesOf(rest) }];
};

/** Principal repays the loan account itself; interest never touches it. */
const loanSplit = (
  rows: readonly TransactionRow[],
  loanId: string,
  interest: readonly TransactionRow[],
  months: readonly string[],
): { principal: number[]; interest: number[] } => {
  const paid = debits(rows, loanId);
  return {
    principal: months.map((month) => amountOf(inMonth(paid, month))),
    interest: months.map((month) => amountOf(inMonth(interest, month))),
  };
};

/**
 * Where the debt lands at the repayment pace already seen. A tail longer than
 * the history it came from would squeeze that history out, so past it: nothing.
 */
export const payoffPoints = (
  balance: readonly Point[],
  principal: readonly number[],
  current: number,
  asOf: string,
): Point[] => {
  const months = payoffProjection(principal, current);
  if (months === undefined || months > balance.length) return [];
  const from = monthOf(asOf);
  return Array.from({ length: months }, (_, step): Point => ({
    x: formatMonthYear(shiftMonth(from, step + 1)),
    y: Math.max(current - (current / months) * (step + 1), 0),
  }));
};

/**
 * The cycle opens the day after the statement is cut, so a ledger read before
 * this month's cut day is still spending against last month's statement.
 */
const cycleStart = (row: AccountRow, asOf: string) => {
  const cut = row.statement_day ?? 1;
  const month = monthOf(asOf);
  const cutMonth =
    dayOf(asOf) > clampDay(month, cut) ? month : shiftMonth(month, -1);
  return shiftDays(firstDayOf(cutMonth), clampDay(cutMonth, cut) - 1);
};

const cardMeta = ({ row, rows, asOf }: MetaInput): AccountMeta => {
  const cycleFrom = cycleStart(row, asOf);
  // A merchant refund is also a debit to the card; only money arriving from
  // an asset account is a payment.
  const assetPrefix = `${segmentOf(row.id, 0)}:asset`;
  const payments = sortBy(
    debits(rows, row.id).filter((entry) =>
      entry.credit_account_id.startsWith(assetPrefix),
    ),
    ["date"],
  );
  const last = payments.at(-1);
  return {
    kind: "card",
    lastPayment:
      last === undefined ? undefined : { amount: last.amount, date: last.date },
    cycleFrom,
    statementDay: row.statement_day,
    dueDay: row.due_day,
  };
};

const loanMeta = ({ row, asOf, interest }: MetaInput): AccountMeta => {
  // The rate is implied by one month's interest, so it is read off a whole one.
  const lastComplete = shiftMonth(monthOf(asOf), -1);
  const monthlyInterest = amountOf(
    interest.filter((entry) => monthOf(entry.date) === lastComplete),
  );
  return {
    kind: "loan",
    original: row.credits_posted,
    paid: row.debits_posted,
    progress: repaidShare(row),
    interestPaid: amountOf(interest),
    impliedApr: impliedAprOf(monthlyInterest, row.balance),
  };
};

const cashMeta = ({ row, rows, asOf }: MetaInput): AccountMeta => {
  const year = asOf.slice(0, 4);
  const paidBy = `${segmentOf(row.id, 0)}:income:interest`;
  return {
    kind: "cash",
    interestEarned: amountOf(
      debits(rows, row.id).filter(
        (entry) =>
          entry.credit_account_id.startsWith(paidBy) &&
          entry.date >= `${year}-01-01`,
      ),
    ),
    year,
    lastActivity: lastDateOf(rows),
    received: row.debits_posted,
    sent: row.credits_posted,
  };
};

const positionMeta = ({
  row,
  rows,
  accounts,
  axis,
  units,
}: MetaInput): AccountMeta => {
  // The ledger stores what a position cost and how much of it is held, never
  // what it is worth today. Every figure here is one of those two, or a ratio.
  const buys = debits(rows, row.id);
  const covered = new Set(axis);
  const inWindow = buys.filter((entry) => covered.has(monthOf(entry.date)));
  const invested12m = amountOf(inWindow);
  const position = unitPositionOf(row, accounts);
  const acquisitions = tradesOf({
    money: rows,
    units,
    position: row.id,
    scale: position?.scale ?? 1,
  }).filter((trade) => trade.acquired);

  return {
    kind: "position",
    buys: inWindow.length,
    lastBuy: lastDateOf(buys),
    invested12m,
    avgMonthly: invested12m / axis.length,
    shares: position?.quantity,
    avgCost: averageCost(row, position),
    lastTrade: acquisitions.at(-1),
  };
};

const basicMeta = ({ row, rows }: MetaInput): AccountMeta => ({
  kind: "basic",
  totalIn: row.debits_posted,
  totalOut: row.credits_posted,
  transactions: rows.length,
  lastActivity: lastDateOf(rows),
});

const META_BUILDER: Record<AccountKind, (input: MetaInput) => AccountMeta> = {
  card: cardMeta,
  loan: loanMeta,
  cash: cashMeta,
  position: positionMeta,
  basic: basicMeta,
};

const cardSeries = ({ row, rows, asOf, months }: MetaInput): AccountSeries => ({
  kind: "card",
  months: months.map(formatMonthAbbr),
  categories: cardSpend(rows, row.id, months),
  cycle: cardCategories(rows, row.id, cycleStart(row, asOf)),
});

const loanSeries = ({
  row,
  rows,
  asOf,
  months,
  interest,
}: MetaInput): AccountSeries => ({
  kind: "loan",
  months: months.map(formatMonthAbbr),
  ...loanSplit(rows, row.id, interest, months),
  balance: monthlyBalance(rows, row.id, months, asOf, row.balance, false),
});

const cashSeries = ({ row, rows, asOf }: MetaInput): AccountSeries => ({
  kind: "cash",
  balance: weeklyBalance(rows, row.id, asOf, row.balance),
});

const positionSeries = ({
  row,
  rows,
  asOf,
  months,
}: MetaInput): AccountSeries => {
  const bought = new Set(
    debits(rows, row.id).map((entry) => monthOf(entry.date)),
  );
  return {
    kind: "position",
    basis: monthlyBalance(rows, row.id, months, asOf, row.balance, true),
    buyPoints: balanceMonthKeys(months, asOf).flatMap((key, index) =>
      bought.has(key) ? [index] : [],
    ),
  };
};

const SERIES_BUILDER: Record<AccountKind, (input: MetaInput) => AccountSeries> =
  {
    card: cardSeries,
    loan: loanSeries,
    cash: cashSeries,
    position: positionSeries,
    basic: () => ({ kind: "basic" }),
  };

/** What the ledger answered for one account; `accountViewOf` derives the rest. */
interface AccountReads {
  readonly row: AccountRow;
  readonly rows: readonly TransactionRow[];
  readonly accounts: readonly AccountRow[];
  readonly today: string;
  /** A loan's interest account, shared between loans, and every row on it. */
  readonly interest:
    | { readonly account: string; readonly rows: readonly TransactionRow[] }
    | undefined;
  /** A position's unit legs, which is where its quantity lives. */
  readonly units: readonly TransactionRow[];
}

export const accountViewOf = ({
  row,
  rows,
  accounts,
  today,
  interest,
  units,
}: AccountReads): AccountView => {
  const { id } = row;
  const asOf = asOfFor(lastDateOf(rows), today);
  const { from, to, months } = windowOf(asOf);
  // Totals run to the present, so the columns cover the postings listed below them.
  const axis = monthsThrough(asOf);

  const byMonth = groupBy(rows, (entry) => monthOf(entry.date));
  const monthly = axis.map((month): MonthFlow => {
    const group = byMonth[month] ?? [];
    return {
      month,
      in: amountOf(debits(group, id)),
      out: amountOf(credits(group, id)),
    };
  });

  const kind = accountKindOf(row);
  const input: MetaInput = {
    row,
    rows,
    accounts,
    asOf,
    months,
    axis,
    // The group id is what splits a shared interest account between its loans.
    interest:
      interest === undefined
        ? []
        : interestLegsFor(rows, debits(interest.rows, interest.account)),
    units,
  };

  return {
    id,
    name: row.name,
    type: row.type,
    subtype: row.subtype,
    currency: row.currency,
    balance: row.balance,
    asOf,
    window: { from, to },
    flow: toAccountFlow(rows, id, row.name, asOf),
    monthly,
    meta: META_BUILDER[kind](input),
    series: SERIES_BUILDER[kind](input),
  };
};
