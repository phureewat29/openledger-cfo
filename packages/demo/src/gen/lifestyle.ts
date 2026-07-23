import type { Merchant } from "../merchants";
import type { Rng } from "../rng";
import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT } from "../accounts";
import { dayIn, within } from "../calendar";
import { FUNDING } from "../funding";
import { MERCHANT } from "../merchants";
import { int, money, pick, skewedMoney } from "../rng";
import { row } from "../types";

/** The club bills the year in two halves, which is how it is actually sold. */
const MEMBERSHIP_MONTHS = [1, 7];
const MEMBERSHIP_DAY = 15;
const MEMBERSHIP_FEE = 42_000;

interface Outing {
  label: string;
  account: string;
  merchants: readonly [Merchant, ...Merchant[]];
  /** Days of the month the outing may fall on; one draw picks how many happen. */
  days: readonly [number, ...number[]];
  minPerMonth: number;
  maxPerMonth: number;
  amount: (rng: Rng) => number;
  funding: string;
}

/**
 * The discretionary half of a senior salary: club golf, restaurants that take
 * reservations, and department stores rather than markets.
 */
const OUTINGS: Outing[] = [
  {
    label: "Golf",
    account: ACCOUNT.golf,
    merchants: [MERCHANT.alpineGolf],
    days: [7, 21, 14],
    minPerMonth: 1,
    maxPerMonth: 2,
    amount: (rng) => money(rng, 3_200, 5_600),
    funding: FUNDING.up,
  },
  {
    label: "Dinner",
    account: ACCOUNT.fineDining,
    merchants: [
      MERCHANT.sorn,
      MERCHANT.gaggan,
      MERCHANT.leDu,
      MERCHANT.sushiMasato,
    ],
    days: [9, 23],
    minPerMonth: 1,
    maxPerMonth: 1,
    amount: (rng) => money(rng, 4_000, 10_000),
    funding: FUNDING.up,
  },
  {
    label: "Cinema",
    account: ACCOUNT.entertainment,
    merchants: [MERCHANT.majorCineplex],
    days: [13, 27],
    minPerMonth: 1,
    maxPerMonth: 2,
    amount: (rng) => money(rng, 400, 1_400),
    funding: FUNDING.first,
  },
  {
    label: "Shopping",
    account: ACCOUNT.departmentStore,
    merchants: [
      MERCHANT.centralChidlom,
      MERCHANT.siamParagon,
      MERCHANT.emquartier,
    ],
    days: [6, 18, 26],
    minPerMonth: 1,
    maxPerMonth: 2,
    amount: (rng) => skewedMoney(rng, 2_500, 10_000),
    funding: FUNDING.first,
  },
];

export const generateLifestyle = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];

  for (const month of ctx.months) {
    for (const outing of OUTINGS) {
      const count = int(ctx.rng, outing.minPerMonth, outing.maxPerMonth);
      for (let slot = 0; slot < count; slot += 1) {
        const day = outing.days[slot % outing.days.length];
        if (day === undefined) continue;
        const date = dayIn(month, day);
        if (!within(date, ctx.window)) continue;
        const merchant = pick(ctx.rng, outing.merchants);
        rows.push(
          row({
            date,
            description: `${outing.label} — ${merchant.canonical}`,
            debit: outing.account,
            credit: outing.funding,
            amount: outing.amount(ctx.rng),
            merchant,
          }),
        );
      }
    }

    if (!MEMBERSHIP_MONTHS.includes(month.month)) continue;
    const dueDate = dayIn(month, MEMBERSHIP_DAY);
    if (!within(dueDate, ctx.window)) continue;
    rows.push(
      row({
        date: dueDate,
        description: "Golf club membership — half year",
        debit: ACCOUNT.golf,
        credit: ACCOUNT.scb,
        amount: MEMBERSHIP_FEE,
        merchant: MERCHANT.alpineGolf,
      }),
    );
  }

  return rows;
};
