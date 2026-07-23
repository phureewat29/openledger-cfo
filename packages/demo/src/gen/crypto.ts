import type { Coin } from "../products/securities";
import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT, unitAccountsOf } from "../accounts";
import { dayIn, monthIndexOf, within } from "../calendar";
import { disposalLegs } from "../disposal";
import { MERCHANT } from "../merchants";
import { formatQuantity, fromUnits, satang, toUnits } from "../money";
import { OPENING_DATE } from "../persona";
import { openingPriceOf, priceOn } from "../prices";
import { COINS, CRYPTO_SALES } from "../products/securities";
import { chance, money } from "../rng";
import { leg, linked } from "../types";

const BUY_DAY = 22;
const BUY_CHANCE = 0.67;
const EXCHANGE = "Bitkub";

/** Coins are recorded in thousandths, so five decimals is the whole precision. */
const coins = (quantity: number, scale: number): string =>
  formatQuantity(quantity / scale, 5);

const baht = (price: number): string => `฿${formatQuantity(price, 0)}`;

/**
 * Crypto is held at cost: a buy is baht for coin, and a sale releases a weighted
 * average of everything the position cost, whatever the coin is worth that day.
 * Writing each as one group is what keeps quantity and money from drifting apart.
 */
export const generateCrypto = (ctx: SeedContext): SeedRow[] => {
  // Thousandths of a coin and satang of cost, both carried as integers so a
  // position replayed across two years is exact.
  const held = new Map<string, number>();
  const basis = new Map<string, number>();
  const rows: SeedRow[] = [];
  let cursor = 0;

  const acquire = (input: {
    coin: Coin;
    date: string;
    price: number;
    budget: number;
    from: string;
    prefix: string;
    onExchange: boolean;
  }): void => {
    const { coin, price } = input;
    const quantityUnits = Math.round(
      (toUnits(input.budget) * coin.unitScale) / price,
    );
    if (quantityUnits <= 0) return;
    const quantity = fromUnits(quantityUnits);
    const cost = satang((quantity / coin.unitScale) * price);
    const unit = unitAccountsOf(coin.unit);
    held.set(coin.account, (held.get(coin.account) ?? 0) + quantityUnits);
    basis.set(coin.account, (basis.get(coin.account) ?? 0) + toUnits(cost));
    rows.push(
      linked({
        date: input.date,
        description: `${input.prefix} ${coins(quantity, coin.unitScale)} @ ${baht(price)}${input.onExchange ? ` — ${EXCHANGE}` : ""}`,
        legs: [
          leg(coin.account, input.from, cost),
          leg(unit.position, unit.equity, quantity),
        ],
        ...(input.onExchange ? { merchant: MERCHANT.bitkub } : {}),
      }),
    );
  };

  for (const coin of COINS) {
    acquire({
      coin,
      date: OPENING_DATE,
      price: openingPriceOf(coin),
      budget: coin.opening,
      from: ACCOUNT.openingTHB,
      prefix: `Opening position — ${coin.ticker}`,
      onExchange: false,
    });
  }

  ctx.months.forEach((month, index) => {
    const buyDate = dayIn(month, BUY_DAY);
    const coin = COINS[cursor % COINS.length];
    if (within(buyDate, ctx.window) && chance(ctx.rng, BUY_CHANCE) && coin) {
      cursor += 1;
      acquire({
        coin,
        date: buyDate,
        price: priceOn(coin, index),
        budget: money(ctx.rng, coin.buyMin, coin.buyMax),
        from: ACCOUNT.kbank,
        prefix: `Buy ${coin.ticker}`,
        onExchange: true,
      });
    }

    for (const sale of CRYPTO_SALES) {
      if (monthIndexOf(sale.date, ctx.window) !== index) continue;
      if (!within(sale.date, ctx.window)) continue;
      const sold = COINS.find((entry) => entry.account === sale.account);
      if (sold === undefined) continue;

      const heldUnits = held.get(sold.account) ?? 0;
      const soldUnits = Math.round(heldUnits * sale.unitsFraction);
      if (soldUnits <= 0) continue;
      const price = priceOn(sold, index);
      const quantity = fromUnits(soldUnits);
      const proceeds = satang((quantity / sold.unitScale) * price);
      const basisUnits = Math.round(
        ((basis.get(sold.account) ?? 0) * soldUnits) / heldUnits,
      );

      held.set(sold.account, heldUnits - soldUnits);
      basis.set(sold.account, (basis.get(sold.account) ?? 0) - basisUnits);
      rows.push(
        linked({
          date: sale.date,
          description: `Sell ${sold.ticker} ${coins(quantity, sold.unitScale)} @ ${baht(price)} — ${EXCHANGE}`,
          legs: disposalLegs({
            cash: sale.toAccount,
            position: sold.account,
            gainAccount: ACCOUNT.realizedGain,
            unit: unitAccountsOf(sold.unit),
            proceedsUnits: toUnits(proceeds),
            basisUnits,
            quantity,
          }),
          merchant: MERCHANT.bitkub,
        }),
      );
    }
  });

  return rows;
};
