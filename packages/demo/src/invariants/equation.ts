import type { AccountType } from "@openledger-cfo/openledger";

import type { Life } from "../dataset";
import type { Totals } from "../expected";
import type { Check } from "./shared";
import { currencyOf } from "../expected";
import { formatMoney, fromUnits, toUnits } from "../money";
import { check, typeOf } from "./shared";

const DEBIT_NATURAL = new Set<AccountType>(["asset", "expense"]);

/**
 * Assets and expenses on one side, everything else on the other. Every row is
 * balanced by construction, so this only fails if a leg reached an account whose
 * declared type contradicts the direction money actually moved in.
 */
export const equationChecks = (life: Life, totals: Totals): Check[] => {
  const types = typeOf(life);
  const perCurrency = new Map<string, number>();

  for (const [account, balance] of Object.entries(totals.balances)) {
    const type = types.get(account);
    if (!type) continue;
    const currency = currencyOf(account);
    const signed = DEBIT_NATURAL.has(type)
      ? toUnits(balance)
      : -toUnits(balance);
    perCurrency.set(currency, (perCurrency.get(currency) ?? 0) + signed);
  }

  return [...perCurrency].map(([currency, units]) =>
    check(
      `accounting equation balances (${currency})`,
      units === 0,
      units === 0 ? "" : `off by ${formatMoney(fromUnits(units))}`,
    ),
  );
};
