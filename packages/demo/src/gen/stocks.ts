import { sumBy } from "es-toolkit";

import type { Holding } from "../products/securities";
import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT, unitAccountsOf } from "../accounts";
import { dayIn, monthIndexOf, within } from "../calendar";
import { disposalLegs } from "../disposal";
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
import {
  dividendOn,
  HOLDINGS,
  perShareOf,
  STOCK_SALES,
} from "../products/securities";
import { jitter, money } from "../rng";
import { leg, linked, row } from "../types";

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

const priced = (holding: Holding, price: number, quantity: number): string =>
  `${shares(quantity)} sh @ $${formatMoney(price)}`;

/**
 * The two legs a purchase is: what it cost and what it bought. Written as one
 * group because neither is true without the other — the price is nowhere in the
 * ledger except as the ratio between them.
 */
const tradeLegs = (
  holding: Holding,
  cash: string,
  cost: number,
  quantity: number,
) => {
  const unit = unitAccountsOf(holding.unit);
  return [
    leg(holding.account, cash, cost),
    leg(unit.position, unit.equity, quantity),
  ];
};

/**
 * The dollar portfolio. Baht leaves the Bangkok Bank account, crosses through
 * the two conversion equity accounts because a transaction may never span
 * currencies, and lands as brokerage cash that the day's buys spend down to
 * where it started. Only dividends accumulate there, which is what the December
 * reinvestment exists to clear.
 */
export const generateStocks = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];
  const rates = fxRateTable(ctx);
  // Shares are carried in hundredths and cost in satang, so a position replayed
  // across two years is exact rather than accumulated in floating point.
  const held = new Map<string, number>();
  const basis = new Map<string, number>();
  let cashUnits = toUnits(openingAmount(ACCOUNT.brokerageCash));
  let cursor = 0;

  const buy = (
    holding: Holding,
    date: string,
    price: number,
    quantityUnits: number,
    description: string,
  ): void => {
    const quantity = fromUnits(quantityUnits);
    const cost = satang(quantity * price);
    held.set(holding.account, (held.get(holding.account) ?? 0) + quantityUnits);
    basis.set(
      holding.account,
      (basis.get(holding.account) ?? 0) + toUnits(cost),
    );
    rows.push(
      linked({
        date,
        description,
        legs: tradeLegs(holding, ACCOUNT.brokerageCash, cost, quantity),
      }),
    );
  };

  for (const holding of HOLDINGS) {
    if (holding.opening <= 0) continue;
    const price = openingPriceOf(holding);
    const quantityUnits = Math.round(toUnits(holding.opening) / price);
    const quantity = fromUnits(quantityUnits);
    const cost = satang(quantity * price);
    held.set(holding.account, quantityUnits);
    basis.set(holding.account, toUnits(cost));
    const unit = unitAccountsOf(holding.unit);
    rows.push(
      linked({
        date: OPENING_DATE,
        description: `Opening position — ${holding.ticker} ${priced(holding, price, quantity)}`,
        legs: [
          leg(holding.account, ACCOUNT.openingUSD, cost),
          leg(unit.position, unit.equity, quantity),
        ],
      }),
    );
  }

  ctx.months.forEach((month, index) => {
    if (QUARTER_END_MONTHS.includes(month.month)) {
      const dividendDate = dayIn(month, DIVIDEND_DAY);
      if (within(dividendDate, ctx.window)) {
        for (const holding of HOLDINGS) {
          const quantity = fromUnits(held.get(holding.account) ?? 0);
          const dividendUnits = toUnits(dividendOn(holding, quantity));
          if (dividendUnits < MIN_DIVIDEND) continue;
          cashUnits += dividendUnits;
          rows.push(
            row({
              date: dividendDate,
              description: `${holding.ticker} dividend — $${formatMoney(perShareOf(holding))}/sh × ${shares(quantity)} sh`,
              debit: ACCOUNT.brokerageCash,
              credit: ACCOUNT.dividendUSD,
              amount: fromUnits(dividendUnits),
            }),
          );
        }
      }
    }

    const buyDate = dayIn(month, BUY_DAY);
    if (within(buyDate, ctx.window)) {
      const rate = rates[index] ?? FX_START;
      const quarterly = QUARTER_END_MONTHS.includes(month.month);
      const thb = quarterly
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

      // Bank fees are per remittance, not per order, so the day's buys share
      // one transfer sized to their combined cost.
      const funded = satang(sumBy(orders, (order) => order.cost));
      if (funded > 0) {
        rows.push(
          linked({
            date: buyDate,
            description: `FX transfer to IBKR @ ${rate.toFixed(2)}`,
            legs: [
              leg(ACCOUNT.conversionTHB, ACCOUNT.bbl, satang(funded * rate)),
              leg(ACCOUNT.brokerageCash, ACCOUNT.conversionUSD, funded),
            ],
          }),
          row({
            date: buyDate,
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
          buyDate,
          order.price,
          order.quantityUnits,
          `Buy ${order.holding.ticker} — ${priced(order.holding, order.price, fromUnits(order.quantityUnits))}`,
        );
      }
    }

    for (const sale of STOCK_SALES) {
      if (monthIndexOf(sale.date, ctx.window) !== index) continue;
      if (!within(sale.date, ctx.window)) continue;
      const holding = HOLDINGS.find((entry) => entry.account === sale.account);
      if (holding === undefined) continue;

      const heldUnits = held.get(holding.account) ?? 0;
      const soldUnits = Math.round(heldUnits * sale.unitsFraction);
      if (soldUnits <= 0) continue;
      const price = priceOn(holding, index);
      const quantity = fromUnits(soldUnits);
      const proceeds = satang(quantity * price);
      const basisUnits = Math.round(
        ((basis.get(holding.account) ?? 0) * soldUnits) / heldUnits,
      );

      held.set(holding.account, heldUnits - soldUnits);
      basis.set(
        holding.account,
        (basis.get(holding.account) ?? 0) - basisUnits,
      );
      cashUnits += toUnits(proceeds);
      rows.push(
        linked({
          date: sale.date,
          description: `Sell ${holding.ticker} — ${priced(holding, price, quantity)}`,
          legs: disposalLegs({
            cash: sale.toAccount,
            position: holding.account,
            gainAccount: ACCOUNT.realizedGainUSD,
            unit: unitAccountsOf(holding.unit),
            proceedsUnits: toUnits(proceeds),
            basisUnits,
            quantity,
          }),
        }),
      );
    }

    if (month.month !== 12) return;
    const sweepDate = dayIn(month, SWEEP_DAY);
    if (!within(sweepDate, ctx.window) || cashUnits <= SWEEP_FLOOR) return;
    const voo = HOLDINGS.find((holding) => holding.account === ACCOUNT.etfVoo);
    if (voo === undefined) return;

    const price = priceOn(voo, index);
    // Floored rather than rounded: the sweep may not reach past the cash that
    // prompted it, and one share is worth more than the reserve left behind.
    const quantityUnits = Math.floor((cashUnits - SWEEP_RESERVE) / price);
    if (quantityUnits <= 0) return;
    cashUnits -= toUnits(satang(fromUnits(quantityUnits) * price));
    buy(
      voo,
      sweepDate,
      price,
      quantityUnits,
      `Buy ${voo.ticker} — ${priced(voo, price, fromUnits(quantityUnits))} (dividend reinvestment)`,
    );
  });

  return rows;
};
