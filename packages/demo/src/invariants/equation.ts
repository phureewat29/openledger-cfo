import { groupBy, mapValues, sumBy } from "es-toolkit";

import type { Life } from "../dataset";
import type { Totals } from "../expected";
import type { Check } from "./shared";
import { currencyOf, DEBIT_NATURAL } from "../expected";
import { formatMoney, fromUnits, toUnits } from "../money";
import { check, typeOf } from "./shared";

/**
 * Assets and expenses on one side, everything else on the other. Every row is
 * balanced by construction, so this only fails if a leg reached an account whose
 * declared type contradicts the direction money actually moved in.
 */
export const equationChecks = (life: Life, totals: Totals): Check[] => {
  const types = typeOf(life);
  const signed = Object.entries(totals.balances).flatMap(
    ([account, balance]) => {
      const type = types.get(account);
      if (!type) return [];
      const units = toUnits(balance);
      return [
        {
          currency: currencyOf(account),
          units: DEBIT_NATURAL.has(type) ? units : -units,
        },
      ];
    },
  );
  const perCurrency = mapValues(
    groupBy(signed, ({ currency }) => currency),
    (group) => sumBy(group, ({ units }) => units),
  );

  return Object.entries(perCurrency).map(([currency, units]) =>
    check(
      `accounting equation balances (${currency})`,
      units === 0,
      units === 0 ? "" : `off by ${formatMoney(fromUnits(units))}`,
    ),
  );
};
