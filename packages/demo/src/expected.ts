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

const bump = (
  totals: Map<string, number>,
  key: string,
  units: number,
): void => {
  totals.set(key, (totals.get(key) ?? 0) + units);
};

const asMoney = (totals: Map<string, number>): Record<string, number> =>
  Object.fromEntries(
    [...totals].map(([currency, units]) => [currency, fromUnits(units)]),
  );

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
  const debits = new Map<string, number>();
  const credits = new Map<string, number>();
  const unknown = new Set<string>();
  let transactions = 0;

  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      transactions += 1;
      const units = toUnits(entry.amount);
      bump(debits, entry.debit_account, units);
      bump(credits, entry.credit_account, units);
      for (const account of [entry.debit_account, entry.credit_account]) {
        if (!typeOf.has(account)) unknown.add(account);
      }
    }
  }

  const balances: Record<string, number> = {};
  const incomeUnits = new Map<string, number>();
  const expenseUnits = new Map<string, number>();

  for (const account of new Set([...debits.keys(), ...credits.keys()])) {
    const type = typeOf.get(account);
    if (!type) continue;
    const debited = debits.get(account) ?? 0;
    const credited = credits.get(account) ?? 0;
    const natural = DEBIT_NATURAL.has(type)
      ? debited - credited
      : credited - debited;
    balances[account] = fromUnits(natural);

    if (type === "income") bump(incomeUnits, currencyOf(account), natural);
    if (type === "expense") bump(expenseUnits, currencyOf(account), natural);
  }

  return {
    transactions,
    rows: rows.length,
    balances,
    income: asMoney(incomeUnits),
    expenses: asMoney(expenseUnits),
    unknownAccounts: [...unknown],
  };
};
