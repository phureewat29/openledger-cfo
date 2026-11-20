import type { DateWindow } from "./calendar";
import { ACCOUNT } from "./accounts";

/** Fixed facts about the persona: the window never reads the clock, so a variant reproduces forever. */
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

/** Openings no product table owns; a priced instrument opens as a quantity, in its own generator. */
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

export const QUARTER_END_MONTHS: readonly number[] = [3, 6, 9, 12];
