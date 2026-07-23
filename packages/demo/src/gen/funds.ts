import type { ThaiFund } from "../products/securities";
import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT, unitAccountsOf } from "../accounts";
import { dayIn, within } from "../calendar";
import {
  formatMoney,
  formatQuantity,
  fromUnits,
  satang,
  toUnits,
} from "../money";
import { OPENING_DATE } from "../persona";
import { openingPriceOf, priceOn } from "../prices";
import { distributionOn, perUnitOf, THAI_FUNDS } from "../products/securities";
import { money } from "../rng";
import { leg, linked, row } from "../types";

const DCA_DAYS = [7, 14, 21, 28];
const TAX_FUND_DAY = 20;

/** A Thai index fund distributes twice a year rather than quarterly. */
const DISTRIBUTION_MONTHS = [5, 11];

/**
 * Ahead of the month's first subscription, so the payout is a rate on units the
 * holder already had — which is also the only order a replay can recover, since
 * nothing recovers the sequence of two rows sharing a date.
 */
const DISTRIBUTION_DAY = 6;

export const generateFunds = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];
  const units = new Map<string, number>();

  /**
   * A subscription is money in and units out. The fund's NAV is nowhere in the
   * ledger as a number of its own — it is the ratio the two legs of this group
   * state, which is the only place a reader can recover it from.
   */
  const subscribe = (input: {
    fund: ThaiFund;
    date: string;
    price: number;
    budget: number;
    from: string;
    label: string;
  }): void => {
    const quantityUnits = Math.round(toUnits(input.budget) / input.price);
    if (quantityUnits <= 0) return;
    const quantity = fromUnits(quantityUnits);
    const unit = unitAccountsOf(input.fund.unit);
    units.set(
      input.fund.account,
      (units.get(input.fund.account) ?? 0) + quantityUnits,
    );
    rows.push(
      linked({
        date: input.date,
        description: `${input.fund.ticker} — ${input.label} ${formatQuantity(quantity, 2)} units @ ฿${formatMoney(input.price)}`,
        legs: [
          leg(input.fund.account, input.from, satang(quantity * input.price)),
          leg(unit.position, unit.equity, quantity),
        ],
      }),
    );
  };

  for (const fund of THAI_FUNDS) {
    subscribe({
      fund,
      date: OPENING_DATE,
      price: openingPriceOf(fund),
      budget: fund.opening,
      from: ACCOUNT.openingTHB,
      label: "opening position",
    });
  }

  ctx.months.forEach((month, index) => {
    const payoutDate = dayIn(month, DISTRIBUTION_DAY);
    if (
      DISTRIBUTION_MONTHS.includes(month.month) &&
      within(payoutDate, ctx.window)
    ) {
      for (const fund of THAI_FUNDS) {
        // An accumulating fund declares no rate, so it has nothing to pay out.
        if (fund.kind !== "dca" || fund.dps <= 0) continue;
        const quantity = fromUnits(units.get(fund.account) ?? 0);
        rows.push(
          row({
            date: payoutDate,
            description: `${fund.ticker} semi-annual distribution — ฿${formatMoney(perUnitOf(fund))}/unit × ${formatQuantity(quantity, 2)} units`,
            debit: fund.payFrom,
            credit: ACCOUNT.dividendTHB,
            amount: distributionOn(fund, quantity),
          }),
        );
      }
    }

    for (const day of DCA_DAYS) {
      const dcaDate = dayIn(month, day);
      if (!within(dcaDate, ctx.window)) continue;
      for (const fund of THAI_FUNDS) {
        if (fund.kind !== "dca") continue;
        subscribe({
          fund,
          date: dcaDate,
          price: priceOn(fund, index),
          budget: money(ctx.rng, fund.dcaMin / 4, fund.dcaMax / 4),
          from: fund.payFrom,
          label: "DCA",
        });
      }
    }

    if (month.month !== 12) return;
    const taxDate = dayIn(month, TAX_FUND_DAY);
    if (!within(taxDate, ctx.window)) return;
    for (const fund of THAI_FUNDS) {
      if (fund.kind !== "tax") continue;
      subscribe({
        fund,
        date: taxDate,
        price: priceOn(fund, index),
        budget: fund.lump,
        from: fund.payFrom,
        label: "year-end subscription",
      });
    }
  });

  return rows;
};
