import type { PaymentSource } from "../accounts";
import type { Merchant } from "../merchants";
import type { SeedContext, SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
import { dayIn, monthKey, within } from "../calendar";
import { MERCHANT } from "../merchants";
import { satang } from "../money";
import { money } from "../rng";
import { row } from "../rows";

interface Subscription {
  day: number;
  merchant: Merchant;
  /** Named where the merchant sells tiers, so a row says which one was billed. */
  plan?: string;
  amount: number;
  funding: PaymentSource;
  /** Cards bill foreign charges in baht and add a separate conversion fee line. */
  foreignCurrency: boolean;
  /** `YYYY-MM` bounds for a price the persona did not pay all window. */
  since?: string;
  until?: string;
}

/** The rate the Anthropic descriptor prints, so the baht and the statement agree. */
const USD_RATE = 36.75;

const inBaht = (usd: number): number => satang(usd * USD_RATE);

const SUBSCRIPTIONS: Subscription[] = [
  {
    day: 2,
    merchant: MERCHANT.netflix,
    amount: 419,
    funding: ACCOUNT.scb,
    foreignCurrency: false,
  },
  {
    day: 3,
    merchant: MERCHANT.spotify,
    amount: 249,
    funding: ACCOUNT.scb,
    foreignCurrency: false,
  },
  {
    day: 5,
    merchant: MERCHANT.youtube,
    amount: 189,
    funding: ACCOUNT.scb,
    foreignCurrency: false,
  },
  {
    day: 6,
    merchant: MERCHANT.disneyPlus,
    amount: 359,
    funding: ACCOUNT.scb,
    foreignCurrency: false,
  },
  {
    day: 7,
    merchant: MERCHANT.icloud,
    amount: 349,
    funding: ACCOUNT.cardTtbAbsolute,
    foreignCurrency: true,
  },
  {
    day: 10,
    merchant: MERCHANT.virginActive,
    amount: 4_500,
    funding: ACCOUNT.cardKbankVisa,
    foreignCurrency: false,
  },
  {
    day: 11,
    merchant: MERCHANT.adobe,
    amount: 1_050,
    funding: ACCOUNT.cardTtbAbsolute,
    foreignCurrency: true,
  },
  {
    day: 13,
    merchant: MERCHANT.anthropic,
    plan: "Claude Pro",
    amount: inBaht(20),
    funding: ACCOUNT.cardTtbAbsolute,
    foreignCurrency: true,
    until: "2025-05",
  },
  {
    day: 13,
    merchant: MERCHANT.anthropic,
    plan: "Claude Max 20x",
    amount: inBaht(200),
    funding: ACCOUNT.cardTtbAbsolute,
    foreignCurrency: true,
    since: "2025-06",
  },
  {
    day: 15,
    merchant: MERCHANT.github,
    amount: 147,
    funding: ACCOUNT.uob,
    foreignCurrency: true,
  },
  {
    day: 16,
    merchant: MERCHANT.notion,
    amount: 360,
    funding: ACCOUNT.uob,
    foreignCurrency: true,
  },
];

const FX_FEE_MIN = 18;
const FX_FEE_MAX = 42;

const billedIn = (subscription: Subscription, month: string): boolean =>
  (subscription.since === undefined || month >= subscription.since) &&
  (subscription.until === undefined || month <= subscription.until);

const describe = (subscription: Subscription): string =>
  [subscription.merchant.canonical, subscription.plan, "subscription"]
    .filter(Boolean)
    .join(" ");

export const generateSubscriptions = (ctx: SeedContext): SeedRow[] =>
  ctx.months.flatMap((month) =>
    SUBSCRIPTIONS.flatMap((subscription) => {
      const chargeDate = dayIn(month, subscription.day);
      if (!within(chargeDate, ctx.window)) return [];
      if (!billedIn(subscription, monthKey(chargeDate))) return [];

      const source = subscription.funding;
      const charge = row({
        date: chargeDate,
        description: describe(subscription),
        debit: subscription.merchant.account,
        credit: source,
        amount: subscription.amount,
        merchant: subscription.merchant,
      });
      if (!subscription.foreignCurrency) return [charge];

      return [
        charge,
        row({
          date: chargeDate,
          description: `FX fee — ${subscription.merchant.canonical}`,
          debit: ACCOUNT.fxFees,
          credit: source,
          amount: money(ctx.rng, FX_FEE_MIN, FX_FEE_MAX),
        }),
      ];
    }),
  );
