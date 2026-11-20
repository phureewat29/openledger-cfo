import type {
  IngestRowInput,
  LinkedLeg,
  LinkedRowInput,
  SimpleRowInput,
} from "@openledger-cfo/openledger";

import type { DateWindow, Month } from "./calendar";
import type { Merchant } from "./merchants";
import type { Rng } from "./rng";
import { toUnits } from "./money";

export type SeedRow = IngestRowInput;

export interface SeedContext {
  window: DateWindow;
  months: Month[];
  rng: Rng;
}

interface RowInput {
  date: string;
  description: string;
  debit: string;
  credit: string;
  amount: number;
  merchant?: Merchant;
}

const merchantFields = (merchant?: Merchant) =>
  merchant === undefined
    ? {}
    : {
        raw_descriptor: merchant.alias,
        merchant: {
          canonical_name: merchant.canonical,
          alias: merchant.alias,
        },
      };

export const row = (input: RowInput): SimpleRowInput => ({
  date: input.date,
  description: input.description,
  debit_account: input.debit,
  credit_account: input.credit,
  amount: input.amount,
  ...merchantFields(input.merchant),
});

export const leg = (
  debit: string,
  credit: string,
  amount: number,
): LinkedLeg => ({
  debit_account: debit,
  credit_account: credit,
  amount,
});

export const linked = (input: {
  date: string;
  description: string;
  legs: LinkedLeg[];
  merchant?: Merchant;
}): LinkedRowInput => ({
  date: input.date,
  description: input.description,
  linked: input.legs,
  ...merchantFields(input.merchant),
});

export const legsOf = (candidate: SeedRow): LinkedLeg[] =>
  "linked" in candidate
    ? candidate.linked
    : [
        leg(
          candidate.debit_account,
          candidate.credit_account,
          candidate.amount,
        ),
      ];

/** Signed integer-satang movements a row makes on the tracked accounts, in leg order, debits before credits. */
export const deltasOf = (
  seedRow: SeedRow,
  tracked: ReadonlySet<string>,
): [account: string, units: number][] =>
  legsOf(seedRow).flatMap((entry) => {
    const units = toUnits(entry.amount);
    const moves: [string, number][] = [
      [entry.debit_account, units],
      [entry.credit_account, -units],
    ];
    return moves.filter(([account]) => tracked.has(account));
  });
