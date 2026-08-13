import { sumBy } from "es-toolkit";

import type { Life } from "../dataset";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { lastDayIn } from "../calendar";
import { currencyOf } from "../expected";
import { formatMoney, fromUnits, toUnits } from "../money";
import { legsOf } from "../types";
import { check } from "./shared";

const assetIds = (life: Life): Set<string> =>
  new Set(
    life.accounts
      .filter((account) => account.type === "asset")
      .map((account) => account.id),
  );

/**
 * The one that locks the refill ordering: a closing balance can be positive
 * while the account spent the summer overdrawn, so this folds the stream in
 * posting order and stops at the first row that puts an asset below zero.
 */
export const solvencyCheck = (life: Life, rows: SeedRow[]): Check => {
  const name = "no asset account ever goes negative";
  const assets = assetIds(life);
  const balances = new Map<string, number>();

  for (const seedRow of rows) {
    const touched = new Set<string>();
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      if (assets.has(entry.debit_account)) {
        const account = entry.debit_account;
        balances.set(account, (balances.get(account) ?? 0) + units);
        touched.add(account);
      }
      if (assets.has(entry.credit_account)) {
        const account = entry.credit_account;
        balances.set(account, (balances.get(account) ?? 0) - units);
        touched.add(account);
      }
    }

    for (const account of touched) {
      const balanceUnits = balances.get(account) ?? 0;
      if (balanceUnits < 0) {
        return check(
          name,
          false,
          `${account} hits ${formatMoney(fromUnits(balanceUnits))} on ${seedRow.date} at "${seedRow.description}"`,
        );
      }
    }
  }

  return check(name, true);
};

/**
 * The guarantee that survives storage. `transactions list` orders by random UUID
 * within a date, so no consumer can recover the order rows were written in and
 * no same-day refill can be proved to precede the spend it funds. Day boundaries
 * are the finest granularity the ledger actually preserves, so the closing
 * balance is what has to hold — and unlike the stream check above, this one is
 * true of the ledger however it chooses to sort.
 */
export const dailyCloseCheck = (life: Life, rows: SeedRow[]): Check => {
  const name = "no asset account closes a day below zero";
  const assets = assetIds(life);
  const perDay = new Map<string, Map<string, number>>();

  for (const seedRow of rows) {
    const day = perDay.get(seedRow.date) ?? new Map<string, number>();
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      if (assets.has(entry.debit_account)) {
        day.set(
          entry.debit_account,
          (day.get(entry.debit_account) ?? 0) + units,
        );
      }
      if (assets.has(entry.credit_account)) {
        day.set(
          entry.credit_account,
          (day.get(entry.credit_account) ?? 0) - units,
        );
      }
    }
    perDay.set(seedRow.date, day);
  }

  const balances = new Map<string, number>();
  for (const date of [...perDay.keys()].sort()) {
    for (const [account, delta] of perDay.get(date) ?? []) {
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
  /** A month that lies wholly inside the window, so its total is a whole month's. */
  readonly full: boolean;
}

/**
 * What a reader sees on the dashboard: income and expenses per calendar month,
 * signed the way `oled report` signs them, in the ledger's own currency.
 */
export const monthlyNets = (life: Life): MonthNet[] => {
  const typeOf = new Map(
    life.accounts.map((account) => [account.id, account.type] as const),
  );
  const primary = life.meta.config.currency;

  return life.months.map((chunk) => {
    let incomeUnits = 0;
    let expenseUnits = 0;
    for (const seedRow of chunk.rows) {
      for (const entry of legsOf(seedRow)) {
        const units = toUnits(entry.amount);
        for (const [account, sign] of [
          [entry.debit_account, -1],
          [entry.credit_account, 1],
        ] as const) {
          if (currencyOf(account) !== primary) continue;
          const type = typeOf.get(account);
          if (type === "income") incomeUnits += sign * units;
          if (type === "expense") expenseUnits -= sign * units;
        }
      }
    }
    const first = `${chunk.month}-01`;
    return {
      month: chunk.month,
      income: fromUnits(incomeUnits),
      expenses: fromUnits(expenseUnits),
      net: fromUnits(incomeUnits - expenseUnits),
      full:
        first >= life.meta.window.start &&
        lastDayIn({
          year: Number(chunk.month.slice(0, 4)),
          month: Number(chunk.month.slice(5, 7)),
        }) <= life.meta.window.end,
    };
  });
};

const NET_FLOOR = 100_000;
const NET_COMFORTABLE = 150_000;
const COMFORTABLE_MONTHS = 14;
const DECEMBER_FLOOR = 600_000;
const SAVINGS_RATE_MIN = 0.32;
const SAVINGS_RATE_MAX = 0.48;

/**
 * The shape of the life, not just its arithmetic. A ledger whose thin months
 * read as near-zero describes someone living to the edge of their income, which
 * is not this persona — so the floor, the spread and the December peaks are
 * assertions in their own right.
 */
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
