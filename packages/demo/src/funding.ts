import { ACCOUNT } from "./accounts";

/**
 * What a spend was paid with. Card spends credit a liability and everything else
 * credits an asset, which is the whole difference between a purchase that shows
 * up on a statement next month and one that leaves the account today.
 */
export const FUNDING = {
  cash: ACCOUNT.cash,
  truemoney: ACCOUNT.truemoney,
  kbank: ACCOUNT.kbank,
  scb: ACCOUNT.scb,
  uobBank: ACCOUNT.uob,
  visa: ACCOUNT.cardKbankVisa,
  absolute: ACCOUNT.cardTtbAbsolute,
  up: ACCOUNT.cardScbUp,
  first: ACCOUNT.cardKrungsriFirst,
} as const;

export type FundingKey = keyof typeof FUNDING;

export type FundingWeights = readonly [
  readonly [FundingKey, number],
  ...(readonly [FundingKey, number])[],
];
