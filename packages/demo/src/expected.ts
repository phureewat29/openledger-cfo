import { groupBy, mapValues, sumBy, uniq } from "es-toolkit";

import type {
  AccountCreateInput,
  AccountType,
  IngestRowInput,
} from "@openledger-cfo/openledger";

import { fromUnits, toUnits } from "./money";
import { legsOf } from "./types";

const DEBIT_NATURAL = new Set<AccountType>(["asset", "expense"]);

export const currencyOf = (accountId: string): string =>
  accountId.slice(0, 3).toUpperCase();

export interface Totals {
  /** `status.counts.transactions` counts legs, so a linked row contributes one per leg. */
  transactions: number;
  rows: number;
  balances: Record<string, number>;
  /** Signed the way `oled report` signs them: income nets credits, expenses net debits. */
  income: Record<string, number>;
  expenses: Record<string, number>;
  unknownAccounts: string[];
}

const sumUnitsBy = (
  entries: readonly { account: string; units: number }[],
): Map<string, number> =>
  new Map(
    Object.entries(
      mapValues(
        groupBy(entries, ({ account }) => account),
        (group) => sumBy(group, ({ units }) => units),
      ),
    ),
  );

const asMoney = (totals: Record<string, number>): Record<string, number> =>
  mapValues(totals, fromUnits);

/**
 * Folds the rows into the same aggregates the ledger will report, in integer
 * satang, so the expected figures are exact rather than float-accumulated.
 */
export const foldTotals = (
  accounts: AccountCreateInput[],
  rows: IngestRowInput[],
): Totals => {
  const typeOf = new Map(
    accounts.map((account) => [account.id, account.type] as const),
  );
  const legs = rows.flatMap(legsOf).map((entry) => ({
    ...entry,
    units: toUnits(entry.amount),
  }));
  const debits = sumUnitsBy(
    legs.map(({ debit_account, units }) => ({ account: debit_account, units })),
  );
  const credits = sumUnitsBy(
    legs.map(({ credit_account, units }) => ({
      account: credit_account,
      units,
    })),
  );
  const unknown = uniq(
    legs
      .flatMap((entry) => [entry.debit_account, entry.credit_account])
      .filter((account) => !typeOf.has(account)),
  );

  const natural = [...new Set([...debits.keys(), ...credits.keys()])].flatMap(
    (account) => {
      const type = typeOf.get(account);
      if (!type) return [];
      const debited = debits.get(account) ?? 0;
      const credited = credits.get(account) ?? 0;
      return [
        {
          account,
          type,
          units: DEBIT_NATURAL.has(type)
            ? debited - credited
            : credited - debited,
        },
      ];
    },
  );
  const byCurrency = (kind: AccountType): Record<string, number> =>
    asMoney(
      mapValues(
        groupBy(
          natural.filter(({ type }) => type === kind),
          ({ account }) => currencyOf(account),
        ),
        (group) => sumBy(group, ({ units }) => units),
      ),
    );

  return {
    transactions: legs.length,
    rows: rows.length,
    balances: Object.fromEntries(
      natural.map(({ account, units }) => [account, fromUnits(units)]),
    ),
    income: byCurrency("income"),
    expenses: byCurrency("expense"),
    unknownAccounts: unknown,
  };
};
