import { sumBy } from "es-toolkit";

import type { Life } from "../dataset";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { unitAccountsOf } from "../accounts";
import { formatMoney, fromUnits, toUnits } from "../money";
import { distributionOn, dividendOn } from "../products/securities";
import { deltasOf, legsOf } from "../types";
import { check, detail } from "./shared";

interface Payer {
  readonly ticker: string;
  readonly account: string;
  readonly position: string;
  /** What the declared rate pays on a quantity held. */
  readonly payout: (quantity: number) => number;
}

export const dividendPayers = (life: Life): Payer[] =>
  life.meta.products.holdings.map((holding) => ({
    ticker: holding.ticker,
    account: holding.account,
    position: unitAccountsOf(holding.unit).position,
    payout: (quantity: number) => dividendOn(holding, quantity),
  }));

export const distributionPayers = (life: Life): Payer[] =>
  life.meta.products.funds.flatMap((fund) =>
    fund.kind === "dca" && fund.dps > 0
      ? [
          {
            ticker: fund.ticker,
            account: fund.account,
            position: unitAccountsOf(fund.unit).position,
            payout: (quantity: number) => distributionOn(fund, quantity),
          },
        ]
      : [],
  );

/**
 * A payout is a rate on a quantity, and both are in the description. Replaying
 * the quantity from the unit legs and recomputing the payout is what stops a
 * dividend or a distribution from drifting away from the position that earned
 * it — the amount is a consequence of the holding, never a figure of its own.
 */
export const payoutCheck = (
  name: string,
  label: string,
  rows: SeedRow[],
  payers: Payer[],
): Check => {
  const tracked = new Set(payers.map((payer) => payer.position));
  const held = new Map<string, number>();
  const faults: string[] = [];
  let seen = 0;

  for (const seedRow of rows) {
    const payer = payers.find((entry) =>
      seedRow.description.startsWith(`${entry.ticker} ${label}`),
    );
    if (payer !== undefined) {
      seen += 1;
      const quantity = fromUnits(held.get(payer.position) ?? 0);
      const posted = sumBy(legsOf(seedRow), (entry) => toUnits(entry.amount));
      const wanted = toUnits(payer.payout(quantity));
      if (posted !== wanted) {
        faults.push(
          `${seedRow.date} ${payer.ticker} pays ${formatMoney(fromUnits(posted))} on ${formatMoney(quantity)}, not ${formatMoney(fromUnits(wanted))}`,
        );
      }
    }

    for (const [position, units] of deltasOf(seedRow, tracked)) {
      held.set(position, (held.get(position) ?? 0) + units);
    }
  }

  return check(
    name,
    seen > 0 && faults.length === 0,
    detail(faults, `${String(seen)} payouts`),
  );
};
