import type { Month } from "../calendar";
import type { Merchant } from "../merchants";
import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT } from "../accounts";
import { addDays, dayIn, within } from "../calendar";
import { FUNDING } from "../funding";
import { MERCHANT } from "../merchants";
import { satang } from "../money";
import { int, money, pick, pickDistinct, skewedMoney } from "../rng";
import { row } from "../types";

/** A place carries its own category: a rail pass is never a clothing spend. */
interface Place {
  label: string;
  account: string;
}

interface Trip {
  label: string;
  startDay: number;
  /** Days before departure the airline was paid; long-haul is booked early. */
  flightLeadDays: number;
  /** Foreign card spends are billed in baht with a conversion fee on their own line. */
  international: boolean;
  flightMerchant: Merchant;
  hotelMerchant: Merchant;
  flightMin: number;
  flightMax: number;
  hotelMin: number;
  hotelMax: number;
  spendMin: number;
  spendMax: number;
  minSpends: number;
  maxSpends: number;
  places: readonly [Place, ...Place[]];
}

const FX_MARKUP = 0.025;

/** Songkran at home, a summer trip and a year-end trip: three a year, two abroad. */
const TRIPS: Record<number, Trip> = {
  4: {
    label: "Songkran — Chiang Mai",
    startDay: 12,
    flightLeadDays: 0,
    international: false,
    flightMerchant: MERCHANT.airAsia,
    hotelMerchant: MERCHANT.agoda,
    flightMin: 4_800,
    flightMax: 7_900,
    hotelMin: 11_000,
    hotelMax: 21_000,
    spendMin: 700,
    spendMax: 5_500,
    minSpends: 4,
    maxSpends: 5,
    places: [
      { label: "Nimman dinner", account: ACCOUNT.restaurants },
      { label: "Old City night market", account: ACCOUNT.entertainment },
      { label: "Doi Suthep day trip", account: ACCOUNT.entertainment },
      { label: "Songkran water gear", account: ACCOUNT.clothing },
      { label: "riverside lunch", account: ACCOUNT.restaurants },
    ],
  },
  7: {
    label: "Summer — Tokyo",
    startDay: 24,
    flightLeadDays: 35,
    international: true,
    flightMerchant: MERCHANT.thaiAirways,
    hotelMerchant: MERCHANT.marriott,
    flightMin: 40_000,
    flightMax: 54_000,
    hotelMin: 30_000,
    hotelMax: 50_000,
    spendMin: 1_800,
    spendMax: 16_000,
    minSpends: 5,
    maxSpends: 6,
    places: [
      { label: "Shinjuku izakaya", account: ACCOUNT.travelDining },
      { label: "Ginza department store", account: ACCOUNT.travelShopping },
      { label: "JR rail pass", account: ACCOUNT.travelShopping },
      { label: "teamLab tickets", account: ACCOUNT.entertainment },
      { label: "Tsukiji breakfast", account: ACCOUNT.travelDining },
      { label: "Don Quijote haul", account: ACCOUNT.travelShopping },
    ],
  },
  12: {
    label: "Year-end — Singapore",
    startDay: 26,
    flightLeadDays: 21,
    international: true,
    flightMerchant: MERCHANT.singaporeAirlines,
    hotelMerchant: MERCHANT.marriott,
    flightMin: 26_000,
    flightMax: 42_000,
    hotelMin: 31_000,
    hotelMax: 54_000,
    spendMin: 2_100,
    spendMax: 19_000,
    minSpends: 4,
    maxSpends: 6,
    places: [
      { label: "Marina Bay dinner", account: ACCOUNT.travelDining },
      { label: "Orchard Road shopping", account: ACCOUNT.travelShopping },
      { label: "Gardens by the Bay", account: ACCOUNT.entertainment },
      { label: "hawker centre lunch", account: ACCOUNT.travelDining },
      { label: "Sentosa day pass", account: ACCOUNT.entertainment },
      { label: "Changi duty free", account: ACCOUNT.travelShopping },
    ],
  },
};

interface FestivalSale {
  day: number;
  label: string;
}

/** Double-date sales are the two nights of the year the cards get a workout. */
const FESTIVAL_SALES: Record<number, FestivalSale> = {
  11: { day: 11, label: "11.11 sale" },
  12: { day: 12, label: "12.12 sale" },
};

const SALE_MERCHANTS = [MERCHANT.shopee, MERCHANT.lazada] as const;

interface BigPurchase {
  date: string;
  description: string;
  account: string;
  amount: number;
  funding: string;
  merchant: Merchant;
}

const BIG_PURCHASES: BigPurchase[] = [
  {
    date: "2024-12-27",
    description: "Apple Store — iPhone 16 Pro Max",
    account: ACCOUNT.electronics,
    amount: 54_900,
    funding: FUNDING.first,
    merchant: MERCHANT.appleStore,
  },
  {
    date: "2025-04-18",
    description: "Apple Store — MacBook Pro M4 Pro",
    account: ACCOUNT.electronics,
    amount: 99_900,
    funding: FUNDING.first,
    merchant: MERCHANT.appleStore,
  },
  {
    date: "2025-09-27",
    description: "Home cinema system",
    account: ACCOUNT.electronics,
    amount: 79_000,
    funding: ACCOUNT.kbank,
    merchant: MERCHANT.powerBuy,
  },
  {
    date: "2026-04-11",
    description: "Living room refurnish",
    account: ACCOUNT.homeGoods,
    amount: 98_000,
    funding: ACCOUNT.kbank,
    merchant: MERCHANT.ikea,
  },
];

/**
 * One spend a day from the day after departure, so a year-end trip that starts
 * on the 26th runs into January rather than piling onto the 28th. Days past the
 * window's end are dropped: the window is the ledger's horizon, not the trip's.
 */
const tripRows = (ctx: SeedContext, month: Month, trip: Trip): SeedRow[] => {
  const departure = dayIn(month, trip.startDay);
  if (!within(departure, ctx.window)) return [];

  // Long-haul is paid for when it is booked, not when it is flown: the airline
  // and the prepaid hotel rate both settle weeks before anyone leaves.
  const booking = addDays(departure, -trip.flightLeadDays);
  const booked = within(booking, ctx.window) ? booking : departure;
  const rows: SeedRow[] = [
    row({
      date: booked,
      description: `Flights — ${trip.label}`,
      debit: ACCOUNT.flights,
      credit: FUNDING.up,
      amount: money(ctx.rng, trip.flightMin, trip.flightMax),
      merchant: trip.flightMerchant,
    }),
    row({
      date: booked,
      description: `Hotel — ${trip.label}`,
      debit: ACCOUNT.hotels,
      credit: FUNDING.up,
      amount: money(ctx.rng, trip.hotelMin, trip.hotelMax),
      merchant: trip.hotelMerchant,
    }),
  ];

  // Spending money is drawn abroad from the account that holds the travel float,
  // so it is a movement between two of the persona's own assets, not a spend.
  if (trip.international) {
    for (const offset of [0, 3]) {
      const drawDate = addDays(departure, offset);
      if (!within(drawDate, ctx.window)) continue;
      rows.push(
        row({
          date: drawDate,
          description: `Foreign ATM withdrawal — ${trip.label}`,
          debit: ACCOUNT.cash,
          credit: ACCOUNT.uob,
          amount: money(ctx.rng, 6_000, 14_000),
        }),
      );
    }
  }

  // The itinerary is settled before the window gets a chance to truncate it.
  const spendCount = int(ctx.rng, trip.minSpends, trip.maxSpends);
  const itinerary = pickDistinct(ctx.rng, trip.places, spendCount);

  itinerary.forEach((place, index) => {
    const spendDate = addDays(departure, index + 1);
    if (!within(spendDate, ctx.window)) return;
    const amount = money(ctx.rng, trip.spendMin, trip.spendMax);
    rows.push(
      row({
        date: spendDate,
        description: `${trip.label} — ${place.label}`,
        debit: place.account,
        credit: FUNDING.absolute,
        amount,
      }),
    );
    if (!trip.international) return;
    rows.push(
      row({
        date: spendDate,
        description: `FX fee — ${trip.label}`,
        debit: ACCOUNT.fxFees,
        credit: FUNDING.absolute,
        amount: satang(amount * FX_MARKUP),
      }),
    );
  });

  return rows;
};

export const generateTravel = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];

  for (const month of ctx.months) {
    const trip = TRIPS[month.month];
    if (trip) rows.push(...tripRows(ctx, month, trip));

    const sale = FESTIVAL_SALES[month.month];
    if (!sale) continue;
    const saleDate = dayIn(month, sale.day);
    if (!within(saleDate, ctx.window)) continue;

    const orders = int(ctx.rng, 3, 5);
    for (let index = 0; index < orders; index += 1) {
      const merchant = pick(ctx.rng, SALE_MERCHANTS);
      rows.push(
        row({
          date: saleDate,
          description: `${sale.label} — ${merchant.canonical}`,
          debit: ACCOUNT.shoppingOnline,
          credit: FUNDING.first,
          amount: skewedMoney(ctx.rng, 1_500, 12_000),
          merchant,
        }),
      );
    }
  }

  for (const purchase of BIG_PURCHASES) {
    if (!within(purchase.date, ctx.window)) continue;
    rows.push(
      row({
        date: purchase.date,
        description: purchase.description,
        debit: purchase.account,
        credit: purchase.funding,
        amount: purchase.amount,
        merchant: purchase.merchant,
      }),
    );
  }

  return rows;
};
