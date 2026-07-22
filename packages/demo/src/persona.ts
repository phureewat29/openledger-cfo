import { sumBy } from "es-toolkit";

import type { DateWindow } from "./calendar";
import { ACCOUNT } from "./accounts";

/**
 * Every number that is a fact about the persona rather than a random draw.
 * Nothing here reads the clock: the window is fixed so a variant reproduces the
 * same ledger forever.
 */
export const PERSONA = {
  userName: "Crossaint Corgi",
  country: "TH",
  currency: "THB",
  locale: "th-TH",
  employer: "Corgi Inc",
  client: "Northbridge Partners",
  window: { start: "2024-09-01", end: "2026-08-10" } satisfies DateWindow,
} as const;

export const OPENING_DATE = PERSONA.window.start;

/**
 * Assets that no product table already owns an opening balance for. A priced
 * instrument is not one of them: its opening is a quantity at a price, so it is
 * declared beside the price curve and opened by the generator that trades it.
 */
export const OPENING_ASSETS_THB: readonly {
  account: string;
  amount: number;
}[] = [
  { account: ACCOUNT.cash, amount: 12_000 },
  { account: ACCOUNT.truemoney, amount: 3_500 },
  { account: ACCOUNT.pvd, amount: 1_850_000 },
  { account: ACCOUNT.condo, amount: 5_800_000 },
  { account: ACCOUNT.house, amount: 3_400_000 },
];

export const OPENING_ASSETS_USD: readonly {
  account: string;
  amount: number;
}[] = [{ account: ACCOUNT.brokerageCash, amount: 1_500 }];

/** What the persona already held at t0, for generators that track a cost basis forward. */
export const openingAmount = (account: string): number =>
  [...OPENING_ASSETS_THB, ...OPENING_ASSETS_USD].find(
    (entry) => entry.account === account,
  )?.amount ?? 0;

/**
 * Thai personal income tax is charged band by band on assessable income, so the
 * marginal rate applies only to the slice inside each band.
 */
const TAX_BANDS = [
  { from: 0, to: 150_000, rate: 0 },
  { from: 150_000, to: 300_000, rate: 0.05 },
  { from: 300_000, to: 500_000, rate: 0.1 },
  { from: 500_000, to: 750_000, rate: 0.15 },
  { from: 750_000, to: 1_000_000, rate: 0.2 },
  { from: 1_000_000, to: 2_000_000, rate: 0.25 },
  { from: 2_000_000, to: 5_000_000, rate: 0.3 },
  { from: 5_000_000, to: Number.POSITIVE_INFINITY, rate: 0.35 },
] as const;

export const annualTax = (assessable: number): number =>
  sumBy(
    TAX_BANDS,
    (band) =>
      Math.max(0, Math.min(assessable, band.to) - band.from) * band.rate,
  );

export const marginalRate = (assessable: number): number =>
  TAX_BANDS.find((band) => assessable > band.from && assessable <= band.to)
    ?.rate ?? 0.35;

/** Employer's stated gross; the raise lands each January. */
const MONTHLY_GROSS_BY_YEAR: Record<number, number> = {
  2024: 320_000,
  2025: 342_400,
  2026: 364_656,
};

const LATEST_MONTHLY_GROSS = 364_656;

export const monthlyGross = (year: number): number =>
  MONTHLY_GROSS_BY_YEAR[year] ?? LATEST_MONTHLY_GROSS;

interface Bonus {
  multiplier: number;
  label: string;
}

export const PAYROLL = {
  paydayOfMonth: 25,
  socialSecurity: 750,
  providentFundRate: 0.075,
  bonusMonths: {
    4: { multiplier: 1, label: "Mid-year bonus" },
    12: { multiplier: 3, label: "Annual bonus" },
  } as Record<number, Bonus>,
} as const;

/**
 * Monthly PND1 withholding is computed from the standard 50%-capped expense
 * deduction, the personal allowance and the social-security contribution only.
 * Provident-fund relief is claimed at filing rather than at source, which is why
 * the persona reliably gets a refund each April.
 */
const EXPENSE_DEDUCTION = 100_000;
const PERSONAL_ALLOWANCE = 60_000;

export const assessableIncome = (year: number): number =>
  monthlyGross(year) * 12 -
  EXPENSE_DEDUCTION -
  PERSONAL_ALLOWANCE -
  PAYROLL.socialSecurity * 12;

/**
 * The second income: a fixed monthly retainer invoiced against 3% withholding.
 * It settles early in the month, which is what puts a month's biggest fixed
 * outgoings — the mortgage on the 1st and the card dues that follow it — behind
 * money that has already arrived rather than in front of it.
 */
export const CONSULTING = {
  paydayOfMonth: 5,
  withholdingRate: 0.03,
  retainerByYear: { 2024: 145_000, 2025: 155_000, 2026: 165_000 } as Record<
    number,
    number
  >,
  latestRetainer: 165_000,
} as const;

export const monthlyRetainer = (year: number): number =>
  CONSULTING.retainerByYear[year] ?? CONSULTING.latestRetainer;

interface StandingOrder {
  day: number;
  from: string;
  to: string;
  amount: number;
  description: string;
}

/**
 * The wiring between the seven accounts. Salary lands in one place and is pushed
 * out to the accounts that owe money, so every other generator can spend from an
 * account that is actually funded.
 */
export const STANDING_ORDERS: StandingOrder[] = [
  {
    day: 8,
    from: ACCOUNT.kbank,
    to: ACCOUNT.uob,
    amount: 5_000,
    description: "Standing order — UOB travel account",
  },
  {
    day: 16,
    from: ACCOUNT.kbank,
    to: ACCOUNT.bbl,
    amount: 5_000,
    description: "Standing order — portfolio funding",
  },
  {
    day: 24,
    from: ACCOUNT.kbank,
    to: ACCOUNT.uob,
    amount: 5_000,
    description: "Standing order — UOB travel account",
  },
  {
    day: 26,
    from: ACCOUNT.kbank,
    to: ACCOUNT.scb,
    amount: 100_000,
    description: "Standing order — SCB bill account",
  },
  {
    day: 27,
    from: ACCOUNT.kbank,
    to: ACCOUNT.ktb,
    amount: 30_000,
    description: "Standing order — family support",
  },
  {
    day: 27,
    from: ACCOUNT.kbank,
    to: ACCOUNT.bay,
    amount: 10_000,
    description: "Standing order — emergency fund",
  },
  // A weekly auto-save moves the same money as one monthly transfer would, and
  // is what the high-yield account's own product literature tells you to set up.
  ...[5, 12, 19, 26].map((day) => ({
    day,
    from: ACCOUNT.kbank,
    to: ACCOUNT.ttbMe,
    amount: 2_500,
    description: "Weekly auto-save — ttb ME Save",
  })),
];

/** December bonus money that is parked rather than spent. */
export const BONUS_SWEEP = {
  month: 12,
  day: 28,
  from: ACCOUNT.kbank,
  to: ACCOUNT.bay,
  amount: 150_000,
  description: "Bonus sweep — emergency fund",
} as const;

export const QUARTER_END_MONTHS: readonly number[] = [3, 6, 9, 12];
