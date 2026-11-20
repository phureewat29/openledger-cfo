import type { PaymentSource } from "../accounts";
import type { Month } from "../calendar";
import type { Merchant } from "../merchants";
import type { SeedContext, SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
import { addDays, dayIn, within } from "../calendar";
import { MERCHANT } from "../merchants";
import { satang } from "../money";
import { int, money, pick, pickDistinct, skewedMoney } from "../rng";
import { row } from "../rows";

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
  funding: PaymentSource;
  merchant: Merchant;
}

const BIG_PURCHASES: BigPurchase[] = [
  {
    date: "2024-12-27",
    description: "Apple Store — iPhone 16 Pro Max",
    account: ACCOUNT.electronics,
    amount: 54_900,
    funding: ACCOUNT.cardKrungsriFirst,
    merchant: MERCHANT.appleStore,
  },
  {
    date: "2025-04-18",
    description: "Apple Store — MacBook Pro M4 Pro",
    account: ACCOUNT.electronics,
    amount: 99_900,
    funding: ACCOUNT.cardKrungsriFirst,
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

const tripRows = (ctx: SeedContext, month: Month, trip: Trip): SeedRow[] => {
  const departure = dayIn(month, trip.startDay);
  if (!within(departure, ctx.window)) return [];

  const booking = addDays(departure, -trip.flightLeadDays);
  const booked = within(booking, ctx.window) ? booking : departure;
  const bookings: SeedRow[] = [
    row({
      date: booked,
      description: `Flights — ${trip.label}`,
      debit: ACCOUNT.flights,
      credit: ACCOUNT.cardScbUp,
      amount: money(ctx.rng, trip.flightMin, trip.flightMax),
      merchant: trip.flightMerchant,
    }),
    row({
      date: booked,
      description: `Hotel — ${trip.label}`,
      debit: ACCOUNT.hotels,
      credit: ACCOUNT.cardScbUp,
      amount: money(ctx.rng, trip.hotelMin, trip.hotelMax),
      merchant: trip.hotelMerchant,
    }),
  ];

  const withdrawals = trip.international
    ? [0, 3]
        .map((offset) => addDays(departure, offset))
        .filter((drawDate) => within(drawDate, ctx.window))
        .map((drawDate) =>
          row({
            date: drawDate,
            description: `Foreign ATM withdrawal — ${trip.label}`,
            debit: ACCOUNT.cash,
            credit: ACCOUNT.uob,
            amount: money(ctx.rng, 6_000, 14_000),
          }),
        )
    : [];

  // The itinerary is settled before the window gets a chance to truncate it.
  const spendCount = int(ctx.rng, trip.minSpends, trip.maxSpends);
  const itinerary = pickDistinct(ctx.rng, trip.places, spendCount);

  const spends = itinerary.flatMap((place, index) => {
    const spendDate = addDays(departure, index + 1);
    if (!within(spendDate, ctx.window)) return [];
    const amount = money(ctx.rng, trip.spendMin, trip.spendMax);
    return [
      row({
        date: spendDate,
        description: `${trip.label} — ${place.label}`,
        debit: place.account,
        credit: ACCOUNT.cardTtbAbsolute,
        amount,
      }),
      ...(trip.international
        ? [
            row({
              date: spendDate,
              description: `FX fee — ${trip.label}`,
              debit: ACCOUNT.fxFees,
              credit: ACCOUNT.cardTtbAbsolute,
              amount: satang(amount * FX_MARKUP),
            }),
          ]
        : []),
    ];
  });

  return [...bookings, ...withdrawals, ...spends];
};

const saleRows = (ctx: SeedContext, month: Month): SeedRow[] => {
  const sale = FESTIVAL_SALES[month.month];
  if (!sale) return [];
  const saleDate = dayIn(month, sale.day);
  if (!within(saleDate, ctx.window)) return [];

  return Array.from({ length: int(ctx.rng, 3, 5) }, () => {
    const merchant = pick(ctx.rng, SALE_MERCHANTS);
    return row({
      date: saleDate,
      description: `${sale.label} — ${merchant.canonical}`,
      debit: ACCOUNT.shoppingOnline,
      credit: ACCOUNT.cardKrungsriFirst,
      amount: skewedMoney(ctx.rng, 1_500, 12_000),
      merchant,
    });
  });
};

export const generateTravel = (ctx: SeedContext): SeedRow[] => [
  ...ctx.months.flatMap((month) => {
    const trip = TRIPS[month.month];
    return [
      ...(trip ? tripRows(ctx, month, trip) : []),
      ...saleRows(ctx, month),
    ];
  }),
  ...BIG_PURCHASES.filter((purchase) => within(purchase.date, ctx.window)).map(
    (purchase) =>
      row({
        date: purchase.date,
        description: purchase.description,
        debit: purchase.account,
        credit: purchase.funding,
        amount: purchase.amount,
        merchant: purchase.merchant,
      }),
  ),
];
