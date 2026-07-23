import type { FundingKey } from "../funding";
import type { Merchant } from "../merchants";
import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT } from "../accounts";
import { dayIn, within } from "../calendar";
import { FUNDING } from "../funding";
import { MERCHANT } from "../merchants";
import { money } from "../rng";
import { row } from "../types";

interface Subscription {
  day: number;
  merchant: Merchant;
  amount: number;
  funding: FundingKey;
  /** Cards bill foreign charges in baht and add a separate conversion fee line. */
  foreignCurrency: boolean;
}

const SUBSCRIPTIONS: Subscription[] = [
  {
    day: 2,
    merchant: MERCHANT.netflix,
    amount: 419,
    funding: "scb",
    foreignCurrency: false,
  },
  {
    day: 3,
    merchant: MERCHANT.spotify,
    amount: 249,
    funding: "scb",
    foreignCurrency: false,
  },
  {
    day: 5,
    merchant: MERCHANT.youtube,
    amount: 189,
    funding: "scb",
    foreignCurrency: false,
  },
  {
    day: 6,
    merchant: MERCHANT.disneyPlus,
    amount: 359,
    funding: "scb",
    foreignCurrency: false,
  },
  {
    day: 7,
    merchant: MERCHANT.icloud,
    amount: 349,
    funding: "absolute",
    foreignCurrency: true,
  },
  {
    day: 10,
    merchant: MERCHANT.virginActive,
    amount: 4_500,
    funding: "visa",
    foreignCurrency: false,
  },
  {
    day: 11,
    merchant: MERCHANT.adobe,
    amount: 1_050,
    funding: "absolute",
    foreignCurrency: true,
  },
  {
    day: 13,
    merchant: MERCHANT.anthropic,
    amount: 735,
    funding: "absolute",
    foreignCurrency: true,
  },
  {
    day: 15,
    merchant: MERCHANT.github,
    amount: 147,
    funding: "uobBank",
    foreignCurrency: true,
  },
  {
    day: 16,
    merchant: MERCHANT.notion,
    amount: 360,
    funding: "uobBank",
    foreignCurrency: true,
  },
];

const FX_FEE_MIN = 18;
const FX_FEE_MAX = 42;

export const generateSubscriptions = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];

  for (const month of ctx.months) {
    for (const subscription of SUBSCRIPTIONS) {
      const chargeDate = dayIn(month, subscription.day);
      if (!within(chargeDate, ctx.window)) continue;

      const source = FUNDING[subscription.funding];
      rows.push(
        row({
          date: chargeDate,
          description: `${subscription.merchant.canonical} subscription`,
          debit: subscription.merchant.account,
          credit: source,
          amount: subscription.amount,
          merchant: subscription.merchant,
        }),
      );

      if (!subscription.foreignCurrency) continue;
      rows.push(
        row({
          date: chargeDate,
          description: `FX fee — ${subscription.merchant.canonical}`,
          debit: ACCOUNT.fxFees,
          credit: source,
          amount: money(ctx.rng, FX_FEE_MIN, FX_FEE_MAX),
        }),
      );
    }
  }

  return rows;
};
