import type { FundingKey, FundingWeights } from "../funding";
import type { Merchant } from "../merchants";
import type { Rng } from "../rng";
import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT } from "../accounts";
import { addDays, eachDay, isWeekend } from "../calendar";
import { FUNDING } from "../funding";
import { MERCHANT } from "../merchants";
import { chance, int, money, pick, skewedMoney, weighted } from "../rng";
import { row } from "../types";

interface DailyStream {
  label: string;
  account: string;
  merchants: readonly [Merchant, ...Merchant[]];
  weekdayChance: number;
  weekendChance: number;
  amount: (rng: Rng) => number;
  funding: FundingWeights;
}

interface CadenceStream {
  label: string;
  account: string;
  merchants: readonly [Merchant, ...Merchant[]];
  intervalDays: number;
  intervalJitter: number;
  amount: (rng: Rng) => number;
  funding: FundingWeights;
}

// Weighted towards the debit account rather than the cards: a household that
// settles as it spends carries less revolving balance into the next month, and
// pays less interest for the privilege of the same basket.
const CARD_HEAVY: FundingWeights = [
  ["visa", 0.34],
  ["first", 0.16],
  ["up", 0.15],
  ["kbank", 0.35],
];

const CASH_HEAVY: FundingWeights = [
  ["cash", 0.38],
  ["truemoney", 0.24],
  ["visa", 0.13],
  ["kbank", 0.25],
];

const MIXED: FundingWeights = [
  ["cash", 0.2],
  ["truemoney", 0.15],
  ["kbank", 0.3],
  ["visa", 0.23],
  ["first", 0.12],
];

const DAILY_STREAMS: DailyStream[] = [
  {
    label: "Morning coffee",
    account: ACCOUNT.coffee,
    merchants: [
      MERCHANT.cafeAmazon,
      MERCHANT.starbucks,
      MERCHANT.roots,
      MERCHANT.blueBottle,
    ],
    weekdayChance: 0.96,
    weekendChance: 0.68,
    amount: (rng) => money(rng, 85, 185),
    funding: CASH_HEAVY,
  },
  {
    label: "Afternoon coffee",
    account: ACCOUNT.coffee,
    merchants: [MERCHANT.starbucks, MERCHANT.roots],
    weekdayChance: 0.52,
    weekendChance: 0.36,
    amount: (rng) => money(rng, 95, 190),
    funding: CARD_HEAVY,
  },
  {
    label: "Lunch",
    account: ACCOUNT.restaurants,
    merchants: [
      MERCHANT.somTamNua,
      MERCHANT.foodCourt,
      MERCHANT.mkRestaurants,
      MERCHANT.bonchon,
    ],
    weekdayChance: 0.94,
    weekendChance: 0.42,
    amount: (rng) => money(rng, 110, 280),
    funding: CASH_HEAVY,
  },
  {
    label: "Dinner",
    account: ACCOUNT.restaurants,
    merchants: [
      MERCHANT.somTamNua,
      MERCHANT.bonchon,
      MERCHANT.mkRestaurants,
      MERCHANT.sushiro,
    ],
    weekdayChance: 0.58,
    weekendChance: 0.32,
    amount: (rng) => money(rng, 180, 460),
    funding: MIXED,
  },
  {
    label: "Dinner out",
    account: ACCOUNT.restaurants,
    merchants: [MERCHANT.afterYou, MERCHANT.sushiro, MERCHANT.peppina],
    weekdayChance: 0.12,
    weekendChance: 0.46,
    amount: (rng) => money(rng, 500, 1_400),
    funding: CARD_HEAVY,
  },
  {
    label: "GrabFood",
    account: ACCOUNT.delivery,
    merchants: [MERCHANT.grabFood],
    weekdayChance: 0.3,
    weekendChance: 0.36,
    amount: (rng) => money(rng, 200, 460),
    funding: CARD_HEAVY,
  },
  {
    label: "LINE MAN",
    account: ACCOUNT.delivery,
    merchants: [MERCHANT.lineman],
    weekdayChance: 0.18,
    weekendChance: 0.24,
    amount: (rng) => money(rng, 180, 420),
    funding: CARD_HEAVY,
  },
  {
    label: "Convenience",
    account: ACCOUNT.restaurants,
    merchants: [MERCHANT.sevenEleven, MERCHANT.familyMart],
    weekdayChance: 0.95,
    weekendChance: 0.82,
    amount: (rng) => money(rng, 50, 180),
    funding: CASH_HEAVY,
  },
  {
    label: "Groceries",
    account: ACCOUNT.groceries,
    merchants: [
      MERCHANT.tops,
      MERCHANT.bigC,
      MERCHANT.villaMarket,
      MERCHANT.makro,
      MERCHANT.gourmetMarket,
    ],
    weekdayChance: 0.24,
    weekendChance: 0.46,
    amount: (rng) => skewedMoney(rng, 300, 1_400),
    funding: CARD_HEAVY,
  },
  {
    label: "Grab ride",
    account: ACCOUNT.grab,
    merchants: [MERCHANT.grab],
    weekdayChance: 0.46,
    weekendChance: 0.38,
    amount: (rng) => money(rng, 110, 350),
    funding: MIXED,
  },
  {
    label: "Rabbit top-up",
    account: ACCOUNT.btsMrt,
    merchants: [MERCHANT.bts],
    weekdayChance: 0.4,
    weekendChance: 0.18,
    amount: (rng) => money(rng, 60, 160),
    funding: CASH_HEAVY,
  },
  {
    label: "Toll",
    account: ACCOUNT.tolls,
    merchants: [MERCHANT.exat],
    weekdayChance: 0.58,
    weekendChance: 0.26,
    amount: (rng) => money(rng, 50, 130),
    funding: CASH_HEAVY,
  },
  {
    label: "Parking",
    account: ACCOUNT.parking,
    merchants: [MERCHANT.centralParking],
    weekdayChance: 0.55,
    weekendChance: 0.36,
    amount: (rng) => money(rng, 40, 180),
    funding: CASH_HEAVY,
  },
  {
    label: "Order",
    account: ACCOUNT.shoppingOnline,
    merchants: [MERCHANT.shopee, MERCHANT.lazada],
    weekdayChance: 0.32,
    weekendChance: 0.36,
    amount: (rng) => skewedMoney(rng, 240, 1_600),
    funding: CARD_HEAVY,
  },
  {
    label: "Pharmacy",
    account: ACCOUNT.pharmacy,
    merchants: [MERCHANT.watsons, MERCHANT.boots],
    weekdayChance: 0.12,
    weekendChance: 0.14,
    amount: (rng) => money(rng, 200, 800),
    funding: CARD_HEAVY,
  },
];

const CADENCE_STREAMS: CadenceStream[] = [
  {
    label: "Fuel",
    account: ACCOUNT.fuel,
    merchants: [MERCHANT.ptt, MERCHANT.shell],
    intervalDays: 8,
    intervalJitter: 3,
    amount: (rng) => money(rng, 1_100, 2_100),
    funding: CARD_HEAVY,
  },
  {
    label: "Clothing",
    account: ACCOUNT.clothing,
    merchants: [MERCHANT.uniqlo, MERCHANT.zara],
    intervalDays: 30,
    intervalJitter: 8,
    amount: (rng) => money(rng, 1_200, 5_200),
    funding: CARD_HEAVY,
  },
  {
    // HomePro and IKEA sell both repairs and furnishings; the repair rows live
    // in household.ts, so these are the furniture and appliance runs.
    label: "Home & living",
    account: ACCOUNT.homeGoods,
    merchants: [MERCHANT.homePro, MERCHANT.ikea],
    intervalDays: 45,
    intervalJitter: 12,
    amount: (rng) => skewedMoney(rng, 700, 7_000),
    funding: CARD_HEAVY,
  },
  {
    label: "Electronics",
    account: ACCOUNT.electronics,
    merchants: [MERCHANT.powerBuy],
    intervalDays: 90,
    intervalJitter: 20,
    amount: (rng) => skewedMoney(rng, 1_200, 10_000),
    funding: CARD_HEAVY,
  },
  {
    label: "Clinic",
    account: ACCOUNT.clinic,
    merchants: [MERCHANT.bumrungrad, MERCHANT.samitivej],
    intervalDays: 75,
    intervalJitter: 25,
    amount: (rng) => money(rng, 1_200, 5_200),
    funding: CARD_HEAVY,
  },
];

const STREET_FOOD_PLACES = [
  "Ari night market",
  "Soi Rangnam stalls",
  "Ekkamai market",
  "Chatuchak food alley",
  "Victory Monument stalls",
] as const;

const STREET_FOOD_CHANCE_WEEKDAY = 0.62;
const STREET_FOOD_CHANCE_WEEKEND = 0.5;

/** Cash rows carry no merchant: a wallet spend leaves no descriptor on a statement. */
const spendRow = (input: {
  date: string;
  description: string;
  account: string;
  amount: number;
  funding: FundingKey;
  merchant: Merchant;
}): SeedRow =>
  row({
    date: input.date,
    description: input.description,
    debit: input.account,
    credit: FUNDING[input.funding],
    amount: input.amount,
    ...(input.funding === "cash" ? {} : { merchant: input.merchant }),
  });

/**
 * The volume driver: everyday spending, weekday/weekend aware. Every stream
 * calls chance() on every day, whether it fires or not — short-circuiting one
 * of those calls shifts every draw after it and rewrites the whole ledger for a
 * given variant.
 */
export const generateDaily = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];
  const days = eachDay(ctx.window);

  const nextDue = new Map<string, string>(
    CADENCE_STREAMS.map((stream) => [
      stream.label,
      addDays(ctx.window.start, int(ctx.rng, 0, stream.intervalDays)),
    ]),
  );

  for (const day of days) {
    const weekend = isWeekend(day);

    for (const stream of DAILY_STREAMS) {
      const probability = weekend ? stream.weekendChance : stream.weekdayChance;
      if (!chance(ctx.rng, probability)) continue;

      const merchant = pick(ctx.rng, stream.merchants);
      rows.push(
        spendRow({
          date: day,
          description: `${stream.label} — ${merchant.canonical}`,
          account: stream.account,
          amount: stream.amount(ctx.rng),
          funding: weighted(ctx.rng, stream.funding),
          merchant,
        }),
      );
    }

    for (const stream of CADENCE_STREAMS) {
      const due = nextDue.get(stream.label) ?? ctx.window.start;
      if (day < due) continue;
      nextDue.set(
        stream.label,
        addDays(
          day,
          int(
            ctx.rng,
            stream.intervalDays - stream.intervalJitter,
            stream.intervalDays + stream.intervalJitter,
          ),
        ),
      );
      const merchant = pick(ctx.rng, stream.merchants);
      rows.push(
        spendRow({
          date: day,
          description: `${stream.label} — ${merchant.canonical}`,
          account: stream.account,
          amount: stream.amount(ctx.rng),
          funding: weighted(ctx.rng, stream.funding),
          merchant,
        }),
      );
    }

    const streetChance = weekend
      ? STREET_FOOD_CHANCE_WEEKEND
      : STREET_FOOD_CHANCE_WEEKDAY;
    if (!chance(ctx.rng, streetChance)) continue;
    rows.push(
      row({
        date: day,
        description: `Street food — ${pick(ctx.rng, STREET_FOOD_PLACES)}`,
        debit: ACCOUNT.restaurants,
        credit: ACCOUNT.cash,
        amount: money(ctx.rng, 60, 180),
      }),
    );
  }

  return rows;
};
