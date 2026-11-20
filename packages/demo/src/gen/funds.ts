import type { Month } from "../calendar";
import type { ThaiFund } from "../products/securities";
import type { SeedContext, SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
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
import { linked, row } from "../rows";
import { acquisitionLegs, createBook } from "./trades";

const DCA_DAYS = [7, 14, 21, 28];
const TAX_FUND_DAY = 20;

const DISTRIBUTION_MONTHS = [5, 11];

// Ahead of the month's first subscription: a replay recovers the units held only
// from dates, never from the order of two rows sharing one.
const DISTRIBUTION_DAY = 6;

const DCA_FUNDS = THAI_FUNDS.flatMap((fund) =>
  fund.kind === "dca" ? [fund] : [],
);
const TAX_FUNDS = THAI_FUNDS.flatMap((fund) =>
  fund.kind === "tax" ? [fund] : [],
);
const PAYING_FUNDS = DCA_FUNDS.filter((fund) => fund.dps > 0);

export const generateFunds = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];
  const book = createBook();

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
    const cost = satang(quantity * input.price);
    book.acquire(input.fund.account, quantityUnits, toUnits(cost));
    rows.push(
      linked({
        date: input.date,
        description: `${input.fund.ticker} — ${input.label} ${formatQuantity(quantity, 2)} units @ ฿${formatMoney(input.price)}`,
        legs: acquisitionLegs(input.fund, input.from, cost, quantity),
      }),
    );
  };

  const distribute = (month: Month): void => {
    const date = dayIn(month, DISTRIBUTION_DAY);
    if (!DISTRIBUTION_MONTHS.includes(month.month)) return;
    if (!within(date, ctx.window)) return;
    for (const fund of PAYING_FUNDS) {
      const quantity = fromUnits(book.heldUnits(fund.account));
      rows.push(
        row({
          date,
          description: `${fund.ticker} semi-annual distribution — ฿${formatMoney(perUnitOf(fund))}/unit × ${formatQuantity(quantity, 2)} units`,
          debit: fund.payFrom,
          credit: ACCOUNT.dividendTHB,
          amount: distributionOn(fund, quantity),
        }),
      );
    }
  };

  const averageIn = (month: Month, index: number): void => {
    for (const day of DCA_DAYS) {
      const date = dayIn(month, day);
      if (!within(date, ctx.window)) continue;
      for (const fund of DCA_FUNDS) {
        subscribe({
          fund,
          date,
          price: priceOn(fund, index),
          budget: money(ctx.rng, fund.dcaMin / 4, fund.dcaMax / 4),
          from: fund.payFrom,
          label: "DCA",
        });
      }
    }
  };

  const yearEndLump = (month: Month, index: number): void => {
    const date = dayIn(month, TAX_FUND_DAY);
    if (month.month !== 12 || !within(date, ctx.window)) return;
    for (const fund of TAX_FUNDS) {
      subscribe({
        fund,
        date,
        price: priceOn(fund, index),
        budget: fund.lump,
        from: fund.payFrom,
        label: "year-end subscription",
      });
    }
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
    distribute(month);
    averageIn(month, index);
    yearEndLump(month, index);
  });

  return rows;
};
