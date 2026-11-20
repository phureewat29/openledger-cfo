import type { Coin } from "../products/securities";
import type { SeedContext, SeedRow } from "../rows";
import type { Sale } from "./trades";
import { ACCOUNT } from "../accounts";
import { dayIn, within } from "../calendar";
import { MERCHANT } from "../merchants";
import { formatQuantity, fromUnits, satang, toUnits } from "../money";
import { OPENING_DATE } from "../persona";
import { openingPriceOf, priceOn } from "../prices";
import { COINS } from "../products/securities";
import { chance, money } from "../rng";
import { linked } from "../rows";
import { acquisitionLegs, createBook, disposalLegs, salesIn } from "./trades";

const BUY_DAY = 22;
const BUY_CHANCE = 0.67;
const EXCHANGE = "Bitkub";

/** The spring 2025 trough sits below every price the position was built at, so that sale books a real loss. */
const CRYPTO_SALES: Sale[] = [
  {
    account: ACCOUNT.cryptoEth,
    date: "2025-04-09",
    unitsFraction: 0.35,
    toAccount: ACCOUNT.kbank,
  },
  {
    account: ACCOUNT.cryptoBtc,
    date: "2025-07-18",
    unitsFraction: 0.35,
    toAccount: ACCOUNT.kbank,
  },
  {
    account: ACCOUNT.cryptoEth,
    date: "2026-03-12",
    unitsFraction: 0.4,
    toAccount: ACCOUNT.kbank,
  },
];

/** Coins are recorded in thousandths, so five decimals is the whole precision. */
const coins = (quantity: number, scale: number): string =>
  formatQuantity(quantity / scale, 5);

const baht = (price: number): string => `฿${formatQuantity(price, 0)}`;

export const generateCrypto = (ctx: SeedContext): SeedRow[] => {
  const book = createBook();
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
    book.acquire(coin.account, quantityUnits, toUnits(cost));
    rows.push(
      linked({
        date: input.date,
        description: `${input.prefix} ${coins(quantity, coin.unitScale)} @ ${baht(price)}${input.onExchange ? ` — ${EXCHANGE}` : ""}`,
        legs: acquisitionLegs(coin, input.from, cost, quantity),
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

    for (const { sale, instrument: sold } of salesIn(
      CRYPTO_SALES,
      COINS,
      ctx,
      index,
    )) {
      const released = book.release(sold.account, sale.unitsFraction);
      if (released === undefined) continue;
      const price = priceOn(sold, index);
      const quantity = fromUnits(released.soldUnits);
      const proceeds = satang((quantity / sold.unitScale) * price);
      rows.push(
        linked({
          date: sale.date,
          description: `Sell ${sold.ticker} ${coins(quantity, sold.unitScale)} @ ${baht(price)} — ${EXCHANGE}`,
          legs: disposalLegs({
            cash: sale.toAccount,
            instrument: sold,
            gainAccount: ACCOUNT.realizedGain,
            proceedsUnits: toUnits(proceeds),
            basisUnits: released.basisUnits,
            quantity,
          }),
          merchant: MERCHANT.bitkub,
        }),
      );
    }
  });

  return rows;
};
