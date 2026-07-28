import { cache } from "react";
import { groupBy, sortBy, sumBy } from "es-toolkit";

import type { AccountRow } from "~/domain/accounts";
import type { FlowGraph } from "~/domain/flows/types";
import type { PositionTrade } from "~/domain/portfolio";
import type { TransactionRow } from "~/domain/postings";
import type { AccountKind, AccountSeries } from "~/domain/series/types";
import { toAccountFlow } from "~/domain/flows/account-flow";
import { formatMonthAbbr } from "~/domain/format";
import {
  impliedAprOf,
  interestAccountFor,
  interestLegsFor,
} from "~/domain/loans";
import {
  clampDay,
  dayOf,
  firstDayOf,
  isoToday,
  monthOf,
  monthsThrough,
  shiftDays,
  shiftMonth,
  windowOf,
} from "~/domain/period";
import {
  averageCost,
  repaidShare,
  tradesOf,
  unitPositionOf,
} from "~/domain/portfolio";
import { segmentOf } from "~/domain/postings";
import {
  balanceMonthKeys,
  cardCategories,
  cardSpend,
  loanSplit,
  monthlyBalance,
  weeklyBalance,
} from "~/domain/series/account";
import { caller } from "~/trpc/server";

export interface MonthFlow {
  readonly month: string;
  /** Money the ledger debited to this account. */
  readonly in: number;
  readonly out: number;
}

/**
 * The facts a header states beside the balance. The balance is already the
 * hero figure, so no cell repeats it — each one carries something the rest of
 * the page does not say.
 */
export type AccountMeta =
  | {
      readonly kind: "card";
      /** The newest payment funded from an asset account; undefined when there has been none. */
      readonly lastPayment:
        | { readonly amount: number; readonly date: string }
        | undefined;
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
  /** Where this account's own story ends — every window is measured from here. */
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

const span = (rows: readonly TransactionRow[]) => {
  const dates = rows.map((row) => row.date).toSorted();
  return { first: dates[0], last: dates.at(-1) };
};

const debits = (rows: readonly TransactionRow[], id: string) =>
  rows.filter((row) => row.debit_account_id === id);

const credits = (rows: readonly TransactionRow[], id: string) =>
  rows.filter((row) => row.credit_account_id === id);

const amountOf = (rows: readonly TransactionRow[]) =>
  sumBy(rows, (row) => row.amount);

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

/** The interest account is shared between loans; the group id splits it. */
const interestLegsOn = async (
  row: AccountRow,
  rows: readonly TransactionRow[],
  accounts: readonly AccountRow[],
): Promise<readonly TransactionRow[]> => {
  const interestId = interestAccountFor(row.id, accounts);
  if (interestId === undefined) return [];
  const interest = await caller.ledger.transactions.listAll({
    account: interestId,
  });
  return interestLegsFor(rows, debits(interest, interestId));
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
    lastActivity: span(rows).last,
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
    lastBuy: span(buys).last,
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
  lastActivity: span(rows).last,
});

/** `<type>:<third segment>` — what the ledger's own taxonomy calls this account. */
const META_KIND: Record<string, AccountKind> = {
  "liability:credit_card": "card",
  "liability:loan": "loan",
  "asset:bank": "cash",
  "asset:wallet": "cash",
  "asset:cash": "cash",
  "asset:stock": "position",
  "asset:etf": "position",
  "asset:fund": "position",
  "asset:crypto": "position",
  "asset:investment": "position",
};

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

export const loadAccount = cache(
  async (id: string): Promise<AccountView | null> => {
    const accounts = await caller.ledger.accounts.list();
    const row = accounts.rows.find((candidate) => candidate.id === id);
    if (row === undefined) return null;

    const rows = await caller.ledger.transactions.listAll({ account: id });

    const today = isoToday();
    const newest = span(rows).last;
    const asOf = newest !== undefined && newest < today ? newest : today;
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

    const kind = META_KIND[`${row.type}:${segmentOf(row.id, 2)}`] ?? "basic";
    const unitAccount = unitPositionOf(row, accounts.rows)?.account;
    const input: MetaInput = {
      row,
      rows,
      accounts: accounts.rows,
      asOf,
      months,
      axis,
      interest:
        kind === "loan" ? await interestLegsOn(row, rows, accounts.rows) : [],
      // Quantity lives in a ledger of its own; the group id is the only join.
      units:
        kind === "position" && unitAccount !== undefined
          ? await caller.ledger.transactions.listAll({ account: unitAccount })
          : [],
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
  },
);
