import { groupBy, mapValues, orderBy, sumBy } from "es-toolkit";

import type { TransactionRow } from "~/ledger/postings";
import type { Point } from "~/lib/charts/data";
import {
  accountKindOf,
  isMoneyCurrency,
  isPrimaryCurrency,
  parseAccountMetadata,
  segmentOf,
  unitCurrencies,
} from "~/ledger/accounts";
import { weeklyBalance } from "~/ledger/history";
import { latestOf } from "~/ledger/period";

/** Every field the account grid reads; the ledger row carries more. */
export interface PortfolioAccount {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly currency: string;
  readonly balance: number;
  readonly debits_posted: number;
  readonly credits_posted: number;
  readonly statement_day: number | null;
  readonly due_day: number | null;
  readonly metadata_json: string | null;
}

interface HoldingClass {
  readonly key: string;
  readonly label: string;
  readonly currency: string;
  readonly groups: readonly string[];
  /** What one unit is called, in a column too narrow for the whole word. */
  readonly unitWord: string;
}

/** Each holding sub-group totals its own currency; baht and dollars never add up. */
const HOLDING_CLASSES: readonly HoldingClass[] = [
  {
    key: "stocks",
    label: "Stocks · USD",
    currency: "USD",
    groups: ["stock", "etf"],
    unitWord: "sh",
  },
  {
    key: "funds",
    label: "Funds",
    currency: "THB",
    groups: ["fund", "investment"],
    unitWord: "u",
  },
  {
    key: "crypto",
    label: "Crypto",
    currency: "THB",
    groups: ["crypto"],
    unitWord: "",
  },
  {
    key: "property",
    label: "Property",
    currency: "THB",
    groups: ["real-estate"],
    unitWord: "",
  },
];

/** What a position holds, as against what it cost. */
export interface UnitPosition {
  readonly account: string;
  readonly quantity: number;
  /** How many ledger units make one share or one coin. */
  readonly scale: number;
}

export interface Holding {
  readonly key: string;
  readonly label: string;
  readonly currency: string;
  readonly rows: readonly PortfolioAccount[];
  readonly total: number;
  readonly unitWord: string;
  /** Quantity held per row id, for the positions that carry a unit ledger. */
  readonly units: Readonly<Record<string, UnitPosition>>;
}

export interface Portfolio {
  readonly banks: readonly PortfolioAccount[];
  readonly cards: readonly PortfolioAccount[];
  readonly openLoans: readonly PortfolioAccount[];
  readonly closedLoans: number;
  readonly holdings: readonly Holding[];
  readonly positions: number;
}

const balanceOf = (rows: readonly PortfolioAccount[]): number =>
  sumBy(rows, (row) => row.balance);

/** A group total is printed in one currency, so it may only add up that one. */
export const thbTotal = (rows: readonly PortfolioAccount[]): number =>
  balanceOf(rows.filter((row) => isPrimaryCurrency(row.currency)));

/** Credits opened the loan and debits repay it, so their ratio is the progress. */
export const repaidShare = (row: PortfolioAccount): number =>
  row.credits_posted > 0
    ? Math.min(row.debits_posted / row.credits_posted, 1)
    : 0;

/** The account states its own ticker; the id's last segment is the fallback. */
export const tickerOf = (row: PortfolioAccount): string =>
  parseAccountMetadata(row)?.ticker ??
  row.id.slice(row.id.lastIndexOf(":") + 1).toUpperCase();

/**
 * The quantity behind a cost. The pointer is on the account, so this follows it
 * rather than assuming any relationship between the two ids.
 */
export const unitPositionOf = (
  row: PortfolioAccount,
  accounts: readonly PortfolioAccount[],
): UnitPosition | undefined => {
  const account = parseAccountMetadata(row)?.unit_account;
  if (account === undefined) return undefined;
  const unit = accounts.find((candidate) => candidate.id === account);
  if (unit === undefined) return undefined;
  const scale = parseAccountMetadata(unit)?.unit_scale ?? 1;
  return { account, quantity: unit.balance / scale, scale };
};

/** Cost over quantity — the average price paid, which the ledger never stores. */
export const averageCost = (
  row: PortfolioAccount,
  position: UnitPosition | undefined,
): number | undefined =>
  position === undefined || position.quantity <= 0
    ? undefined
    : row.balance / position.quantity;

export interface PositionTrade {
  readonly date: string;
  readonly quantity: number;
  readonly price: number;
  /** An acquisition grew the position; a disposal's money leg carries basis. */
  readonly acquired: boolean;
}

/**
 * The prices the ledger never wrote down. A trade is a money leg beside a unit
 * leg in one group, and dividing them is the only way back to what was paid.
 */
export const tradesOf = (input: {
  readonly money: readonly TransactionRow[];
  readonly units: readonly TransactionRow[];
  readonly position: string;
  readonly scale: number;
}): PositionTrade[] => {
  const byGroup = new Map(
    input.units.flatMap((row) =>
      row.group_id === null ? [] : [[row.group_id, row] as const],
    ),
  );
  return input.money
    .flatMap((row) => {
      const unit =
        row.group_id === null ? undefined : byGroup.get(row.group_id);
      const quantity = (unit?.amount ?? 0) / input.scale;
      if (quantity <= 0) return [];
      return [
        {
          date: row.date,
          quantity,
          price: row.amount / quantity,
          acquired: row.debit_account_id === input.position,
        },
      ];
    })
    .toSorted((left, right) => left.date.localeCompare(right.date));
};

/** "Banks & cash" also lists the USD brokerage cash leg: held money, but not baht runway. */
const isBank = (row: PortfolioAccount) =>
  accountKindOf(row) === "cash" ||
  (row.type === "asset" && segmentOf(row.id, 2) === "brokerage");

const isCard = (row: PortfolioAccount) => accountKindOf(row) === "card";

const isLoan = (row: PortfolioAccount) => accountKindOf(row) === "loan";

/**
 * The account grid's four classes, each sorted the way its pane reads. Liabilities
 * keep their positive magnitude: the column head already says they are owed.
 */
export const splitPortfolio = (
  accounts: readonly PortfolioAccount[],
): Portfolio => {
  // Unit ledgers are quantities, not money, and stay out of every group and
  // total — dropped here, not before the join needs them.
  const units = unitCurrencies(accounts);
  const money = accounts.filter((row) => isMoneyCurrency(row.currency, units));
  const loans = money.filter(isLoan);
  const openLoans = loans.filter((row) => row.balance > 0);

  const holdings = HOLDING_CLASSES.map((holding): Holding => {
    const rows = orderBy(
      money.filter(
        (row) =>
          row.type === "asset" && holding.groups.includes(segmentOf(row.id, 2)),
      ),
      [(row) => row.balance],
      ["desc"],
    );
    return {
      key: holding.key,
      label: holding.label,
      currency: holding.currency,
      rows,
      total: balanceOf(rows),
      unitWord: holding.unitWord,
      units: Object.fromEntries(
        rows.flatMap((row) => {
          const position = unitPositionOf(row, accounts);
          return position === undefined ? [] : [[row.id, position] as const];
        }),
      ),
    };
  }).filter((holding) => holding.rows.length > 0);

  return {
    banks: orderBy(money.filter(isBank), [(row) => row.balance], ["desc"]),
    cards: orderBy(
      money.filter(isCard),
      [(row) => row.due_day ?? Number.MAX_SAFE_INTEGER, (row) => row.name],
      ["asc", "asc"],
    ),
    openLoans: orderBy(openLoans, [(row) => row.balance], ["desc"]),
    closedLoans: loans.length - openLoans.length,
    holdings,
    positions: sumBy(holdings, (holding) => holding.rows.length),
  };
};

/** Half a year of weekly samples: as much shape as a 60px line can carry. */
const SPARK_WEEKS = 24;

interface RecentActivity {
  /** Account id to the newest date it moved, which is what makes a dormant account visible. */
  readonly activity: Readonly<Record<string, string | undefined>>;
  /** Recent weekly balances per bank leaf, folded from rows already in hand. */
  readonly sparks: Readonly<Record<string, readonly Point[]>>;
}

export const recentActivity = (
  leaves: readonly PortfolioAccount[],
  rows: readonly TransactionRow[],
  asOf: string,
): RecentActivity => {
  // One walk re-files every row under both accounts it touches.
  const byAccount = mapValues(
    groupBy(
      rows.flatMap((row) => [
        { account: row.debit_account_id, row },
        { account: row.credit_account_id, row },
      ]),
      (leg) => leg.account,
    ),
    (legs) => legs.map((leg) => leg.row),
  );
  return {
    activity: mapValues(byAccount, (legs) =>
      latestOf(legs.map((row) => row.date)),
    ),
    sparks: Object.fromEntries(
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
    ),
  };
};
