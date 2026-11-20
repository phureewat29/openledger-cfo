import { groupBy, mapValues, sumBy, uniq } from "es-toolkit";

import type { AccountType } from "@openledger-cfo/openledger";

import type { Life } from "../dataset";
import type { SeedRow } from "../rows";
import type { Check } from "./shared";
import { isWholeMonth, monthOf } from "../calendar";
import { currencyOf } from "../expected";
import { formatMoney, fromUnits, toUnits } from "../money";
import { deltasOf, legsOf } from "../rows";
import { check, typeOf } from "./shared";

const assetIds = (life: Life): Set<string> =>
  new Set(
    life.accounts
      .filter((account) => account.type === "asset")
      .map((account) => account.id),
  );

/** Folds in posting order: a positive close can hide a stretch spent overdrawn. */
export const solvencyCheck = (life: Life, rows: SeedRow[]): Check => {
  const name = "no asset account ever goes negative";
  const assets = assetIds(life);
  const balances = new Map<string, number>();

  for (const seedRow of rows) {
    const deltas = deltasOf(seedRow, assets);
    for (const [account, units] of deltas) {
      balances.set(account, (balances.get(account) ?? 0) + units);
    }
    const overdrawn = uniq(deltas.map(([account]) => account)).find(
      (account) => (balances.get(account) ?? 0) < 0,
    );
    if (overdrawn !== undefined) {
      return check(
        name,
        false,
        `${overdrawn} hits ${formatMoney(fromUnits(balances.get(overdrawn) ?? 0))} on ${seedRow.date} at "${seedRow.description}"`,
      );
    }
  }

  return check(name, true);
};

/**
 * `transactions list` orders by random UUID within a date, so intra-day
 * order is unrecoverable — only the day's closing balance can be required.
 */
export const dailyCloseCheck = (life: Life, rows: SeedRow[]): Check => {
  const name = "no asset account closes a day below zero";
  const assets = assetIds(life);
  const perDay = mapValues(
    groupBy(rows, (seedRow) => seedRow.date),
    (dayRows) => {
      const day = new Map<string, number>();
      for (const [account, units] of dayRows.flatMap((seedRow) =>
        deltasOf(seedRow, assets),
      )) {
        day.set(account, (day.get(account) ?? 0) + units);
      }
      return day;
    },
  );

  const balances = new Map<string, number>();
  for (const date of Object.keys(perDay).sort()) {
    for (const [account, delta] of perDay[date] ?? []) {
      const closing = (balances.get(account) ?? 0) + delta;
      balances.set(account, closing);
      if (closing < 0) {
        return check(
          name,
          false,
          `${account} closes ${formatMoney(fromUnits(closing))} on ${date}`,
        );
      }
    }
  }

  return check(name, true);
};

interface MonthNet {
  readonly month: string;
  readonly income: number;
  readonly expenses: number;
  readonly net: number;
  readonly full: boolean;
}

/** Signed the way `oled report` signs them, in the ledger's own currency. */
export const monthlyNets = (life: Life): MonthNet[] => {
  const types = typeOf(life);
  const primary = life.meta.config.currency;

  return life.months.map((chunk) => {
    const movements = chunk.rows
      .flatMap(legsOf)
      .flatMap((entry) => {
        const units = toUnits(entry.amount);
        return [
          { account: entry.debit_account, signed: -units },
          { account: entry.credit_account, signed: units },
        ];
      })
      .filter(({ account }) => currencyOf(account) === primary);
    const unitsOf = (kind: AccountType): number =>
      sumBy(movements, ({ account, signed }) =>
        types.get(account) === kind ? signed : 0,
      );
    const incomeUnits = unitsOf("income");
    const expenseUnits = -unitsOf("expense");
    return {
      month: chunk.month,
      income: fromUnits(incomeUnits),
      expenses: fromUnits(expenseUnits),
      net: fromUnits(incomeUnits - expenseUnits),
      full: isWholeMonth(monthOf(chunk.month), life.meta.window),
    };
  });
};

const NET_FLOOR = 100_000;
const NET_COMFORTABLE = 150_000;
const COMFORTABLE_MONTHS = 14;
const DECEMBER_FLOOR = 600_000;
const SAVINGS_RATE_MIN = 0.32;
const SAVINGS_RATE_MAX = 0.48;

export const netHealthChecks = (life: Life): Check[] => {
  const months = monthlyNets(life);
  const full = months.filter((month) => month.full);
  const thin = full.filter((month) => month.net < NET_FLOOR);
  const comfortable = full.filter((month) => month.net >= NET_COMFORTABLE);
  const decembers = full.filter((month) => month.month.endsWith("-12"));
  const weakDecember = decembers.filter((month) => month.net < DECEMBER_FLOOR);
  const income = sumBy(months, (month) => month.income);
  const rate = income === 0 ? 0 : sumBy(months, (month) => month.net) / income;
  const lowest = [...full].sort((left, right) => left.net - right.net)[0];

  return [
    check(
      "every full month clears the net floor",
      full.length > 0 && thin.length === 0,
      thin.length > 0
        ? thin
            .slice(0, 3)
            .map((month) => `${month.month} nets ${formatMoney(month.net)}`)
            .join(" · ")
        : `lowest ${lowest?.month ?? "—"} at ${formatMoney(lowest?.net ?? 0)}`,
    ),
    check(
      "most full months are comfortable, not merely solvent",
      comfortable.length >= COMFORTABLE_MONTHS,
      `${String(comfortable.length)}/${String(full.length)} months clear ${formatMoney(NET_COMFORTABLE)}`,
    ),
    check(
      "bonus months land as bonus months",
      decembers.length > 0 && weakDecember.length === 0,
      decembers
        .map((month) => `${month.month} ${formatMoney(month.net)}`)
        .join(" · "),
    ),
    check(
      "the window saves a plausible share of what it earns",
      rate >= SAVINGS_RATE_MIN && rate <= SAVINGS_RATE_MAX,
      `${(rate * 100).toFixed(1)}% of ${formatMoney(income)}`,
    ),
  ];
};
