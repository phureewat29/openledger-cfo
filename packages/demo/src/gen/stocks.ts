import { sumBy } from "es-toolkit";

import type { Month } from "../calendar";
import type { Holding } from "../products/securities";
import type { SeedContext, SeedRow } from "../rows";
import type { Sale } from "./trades";
import { ACCOUNT } from "../accounts";
import { dayIn, within } from "../calendar";
import { MERCHANT } from "../merchants";
import {
  formatMoney,
  formatQuantity,
  fromUnits,
  satang,
  toUnits,
} from "../money";
import { OPENING_DATE, openingAmount, QUARTER_END_MONTHS } from "../persona";
import { openingPriceOf, priceOn } from "../prices";
import { dividendOn, HOLDINGS, perShareOf } from "../products/securities";
import { jitter, money } from "../rng";
import { leg, linked, row } from "../rows";
import { acquisitionLegs, createBook, disposalLegs, salesIn } from "./trades";

const FX_START = 34.8;
const FX_END = 36.9;
const FX_JITTER = 0.4;

const BUY_DAY = 18;
const DIVIDEND_DAY = 15;
const SWEEP_DAY = 20;

const BUDGET_MIN = 62_000;
const BUDGET_MAX = 70_000;
const QUARTER_BUDGET_MIN = 88_000;
const QUARTER_BUDGET_MAX = 96_000;
const REMITTANCE_FEE = 500;

/** Three tickers only once the transfer covers three buys of at least $800. */
const THREE_WAY_FLOOR = 240_000;

/** A payout smaller than a dollar is not worth a line on a statement. */
const MIN_DIVIDEND = 100;
const SWEEP_FLOOR = 100_000;
const SWEEP_RESERVE = 50_000;

const STOCK_SALES: Sale[] = [
  {
    account: ACCOUNT.stockTsla,
    date: "2026-02-18",
    unitsFraction: 0.25,
    toAccount: ACCOUNT.brokerageCash,
  },
];

/** THB drifts against the dollar across the window; each month's rate is drawn once. */
const fxRateTable = (ctx: SeedContext): number[] => {
  const span = Math.max(ctx.months.length - 1, 1);
  return ctx.months.map((_, index) => {
    const trend = FX_START + ((FX_END - FX_START) * index) / span;
    return satang(jitter(ctx.rng, trend, FX_JITTER));
  });
};

/** A rotation rather than a draw, so every holding is bought at a regular turn. */
const rotate = (start: number, count: number): Holding[] =>
  Array.from(
    { length: count },
    (_, offset) => HOLDINGS[(start + offset) % HOLDINGS.length],
  ).filter((holding) => holding !== undefined);

/** Even shares: the last one absorbs the rounding so the buys spend the transfer exactly. */
const splitEvenly = (total: number, count: number): number[] => {
  const share = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? total - share * (count - 1) : share,
  );
};

const shares = (units: number): string => formatQuantity(units, 2);

const priced = (price: number, quantity: number): string =>
  `${shares(quantity)} sh @ $${formatMoney(price)}`;

/**
 * Baht reaches the brokerage through the two conversion equity accounts, since a
 * transaction may never span currencies; only dividends accumulate as cash.
 */
export const generateStocks = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];
  const rates = fxRateTable(ctx);
  const book = createBook();
  let cashUnits = toUnits(openingAmount(ACCOUNT.brokerageCash));
  let cursor = 0;

  const buy = (
    holding: Holding,
    date: string,
    price: number,
    quantityUnits: number,
    description: string,
    from: string = ACCOUNT.brokerageCash,
  ): void => {
    const quantity = fromUnits(quantityUnits);
    const cost = satang(quantity * price);
    book.acquire(holding.account, quantityUnits, toUnits(cost));
    rows.push(
      linked({
        date,
        description,
        legs: acquisitionLegs(holding, from, cost, quantity),
      }),
    );
  };

  const payDividends = (month: Month): void => {
    const date = dayIn(month, DIVIDEND_DAY);
    if (!QUARTER_END_MONTHS.includes(month.month)) return;
    if (!within(date, ctx.window)) return;
    for (const holding of HOLDINGS) {
      const quantity = fromUnits(book.heldUnits(holding.account));
      const dividendUnits = toUnits(dividendOn(holding, quantity));
      if (dividendUnits < MIN_DIVIDEND) continue;
      cashUnits += dividendUnits;
      rows.push(
        row({
          date,
          description: `${holding.ticker} dividend — $${formatMoney(perShareOf(holding))}/sh × ${shares(quantity)} sh`,
          debit: ACCOUNT.brokerageCash,
          credit: ACCOUNT.dividendUSD,
          amount: fromUnits(dividendUnits),
        }),
      );
    }
  };

  const buyMonth = (month: Month, index: number): void => {
    const date = dayIn(month, BUY_DAY);
    if (!within(date, ctx.window)) return;
    const rate = rates[index] ?? FX_START;
    const thb = QUARTER_END_MONTHS.includes(month.month)
      ? money(ctx.rng, QUARTER_BUDGET_MIN, QUARTER_BUDGET_MAX)
      : money(ctx.rng, BUDGET_MIN, BUDGET_MAX);
    const usdUnits = Math.round(toUnits(thb) / rate);
    const count = usdUnits >= THREE_WAY_FLOOR ? 3 : 2;
    const picks = rotate(cursor, count);
    cursor = (cursor + count) % HOLDINGS.length;

    const orders = splitEvenly(usdUnits, picks.length).flatMap(
      (budgetUnits, slot) => {
        const holding = picks[slot];
        if (holding === undefined || budgetUnits <= 0) return [];
        const price = priceOn(holding, index);
        const quantityUnits = Math.round(budgetUnits / price);
        if (quantityUnits <= 0) return [];
        const cost = satang(fromUnits(quantityUnits) * price);
        return [{ holding, price, quantityUnits, cost }];
      },
    );

    // Bank fees are per remittance, so the day's buys share one transfer.
    const funded = satang(sumBy(orders, (order) => order.cost));
    if (funded > 0) {
      rows.push(
        linked({
          date,
          description: `FX transfer to IBKR @ ${rate.toFixed(2)}`,
          legs: [
            leg(ACCOUNT.conversionTHB, ACCOUNT.bbl, satang(funded * rate)),
            leg(ACCOUNT.brokerageCash, ACCOUNT.conversionUSD, funded),
          ],
        }),
        row({
          date,
          description: "Outward remittance fee",
          debit: ACCOUNT.brokerageFees,
          credit: ACCOUNT.bbl,
          amount: REMITTANCE_FEE,
          merchant: MERCHANT.ibkr,
        }),
      );
    }

    for (const order of orders) {
      buy(
        order.holding,
        date,
        order.price,
        order.quantityUnits,
        `Buy ${order.holding.ticker} — ${priced(order.price, fromUnits(order.quantityUnits))}`,
      );
    }
  };

  const sell = (index: number): void => {
    for (const { sale, instrument: holding } of salesIn(
      STOCK_SALES,
      HOLDINGS,
      ctx,
      index,
    )) {
      const released = book.release(holding.account, sale.unitsFraction);
      if (released === undefined) continue;
      const price = priceOn(holding, index);
      const quantity = fromUnits(released.soldUnits);
      const proceedsUnits = toUnits(satang(quantity * price));
      cashUnits += proceedsUnits;
      rows.push(
        linked({
          date: sale.date,
          description: `Sell ${holding.ticker} — ${priced(price, quantity)}`,
          legs: disposalLegs({
            cash: sale.toAccount,
            instrument: holding,
            gainAccount: ACCOUNT.realizedGainUSD,
            proceedsUnits,
            basisUnits: released.basisUnits,
            quantity,
          }),
        }),
      );
    }
  };

  const reinvest = (month: Month, index: number): void => {
    const date = dayIn(month, SWEEP_DAY);
    if (month.month !== 12) return;
    if (!within(date, ctx.window) || cashUnits <= SWEEP_FLOOR) return;
    const voo = HOLDINGS.find((holding) => holding.account === ACCOUNT.etfVoo);
    if (voo === undefined) return;

    const price = priceOn(voo, index);
    // Floored: the sweep may not spend past the cash that prompted it.
    const quantityUnits = Math.floor((cashUnits - SWEEP_RESERVE) / price);
    if (quantityUnits <= 0) return;
    cashUnits -= toUnits(satang(fromUnits(quantityUnits) * price));
    buy(
      voo,
      date,
      price,
      quantityUnits,
      `Buy ${voo.ticker} — ${priced(price, fromUnits(quantityUnits))} (dividend reinvestment)`,
    );
  };

  for (const holding of HOLDINGS) {
    if (holding.opening <= 0) continue;
    const price = openingPriceOf(holding);
    const quantityUnits = Math.round(toUnits(holding.opening) / price);
    buy(
      holding,
      OPENING_DATE,
      price,
      quantityUnits,
      `Opening position — ${holding.ticker} ${priced(price, fromUnits(quantityUnits))}`,
      ACCOUNT.openingUSD,
    );
  }

  ctx.months.forEach((month, index) => {
    payDividends(month);
    buyMonth(month, index);
    sell(index);
    reinvest(month, index);
  });

  return rows;
};
