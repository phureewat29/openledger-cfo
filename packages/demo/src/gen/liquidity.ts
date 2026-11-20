import { sumBy } from "es-toolkit";

import type { SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
import { fromUnits, roundUpTo, toUnits } from "../money";
import { deltasOf, row } from "../rows";

interface TopUpRule {
  account: string;
  source: string;
  /** Balance that triggers a top-up, and the level it is restored to. */
  floor: number;
  target: number;
  roundTo: number;
  description: string;
}

// Each account is refilled before the account that funds it: a refill is itself
// an outflow the next rule has to see.
const TOP_UP_RULES: TopUpRule[] = [
  {
    account: ACCOUNT.cash,
    source: ACCOUNT.kbank,
    floor: 500,
    target: 12_000,
    roundTo: 1_000,
    description: "ATM withdrawal",
  },
  {
    account: ACCOUNT.truemoney,
    source: ACCOUNT.kbank,
    floor: 200,
    target: 3_000,
    roundTo: 100,
    description: "TrueMoney wallet top-up",
  },
  {
    account: ACCOUNT.scb,
    source: ACCOUNT.kbank,
    floor: 20_000,
    target: 150_000,
    roundTo: 10_000,
    description: "Top-up transfer — SCB bill account",
  },
  {
    account: ACCOUNT.uob,
    source: ACCOUNT.kbank,
    floor: 5_000,
    target: 60_000,
    roundTo: 5_000,
    description: "Top-up transfer — UOB travel account",
  },
  {
    account: ACCOUNT.bbl,
    source: ACCOUNT.kbank,
    floor: 20_000,
    target: 150_000,
    roundTo: 10_000,
    description: "Top-up transfer — Bangkok Bank",
  },
  {
    account: ACCOUNT.ktb,
    source: ACCOUNT.kbank,
    floor: 5_000,
    target: 40_000,
    roundTo: 5_000,
    description: "Top-up transfer — family account",
  },
  {
    account: ACCOUNT.kbank,
    source: ACCOUNT.ttbMe,
    floor: 50_000,
    target: 350_000,
    roundTo: 10_000,
    description: "Transfer from ttb ME Save",
  },
  {
    account: ACCOUNT.ttbMe,
    source: ACCOUNT.bay,
    floor: 100_000,
    target: 600_000,
    roundTo: 50_000,
    description: "Transfer from emergency fund",
  },
];

/** Splices a refill in ahead of the breaching spend: a batch posts in array order, so same-day dating is not enough. */
const applyRule = (rows: SeedRow[], rule: TopUpRule): SeedRow[] => {
  const floorUnits = toUnits(rule.floor);
  const targetUnits = toUnits(rule.target);
  const stepUnits = toUnits(rule.roundTo);

  const tracked = new Set([rule.account]);
  const merged: SeedRow[] = [];
  let balanceUnits = 0;

  for (const seedRow of rows) {
    const delta = sumBy(deltasOf(seedRow, tracked), ([, units]) => units);
    if (delta !== 0 && balanceUnits + delta < floorUnits) {
      const amountUnits = roundUpTo(
        Math.max(targetUnits, floorUnits - delta) - balanceUnits,
        stepUnits,
      );
      balanceUnits += amountUnits;
      merged.push(
        row({
          date: seedRow.date,
          description: rule.description,
          debit: rule.account,
          credit: rule.source,
          amount: fromUnits(amountUnits),
        }),
      );
    }
    balanceUnits += delta;
    merged.push(seedRow);
  }

  return merged;
};

/** Expects the date-sorted stream. */
export const applyLiquidity = (rows: SeedRow[]): SeedRow[] =>
  TOP_UP_RULES.reduce<SeedRow[]>(
    (funded, rule) => applyRule(funded, rule),
    rows,
  );
