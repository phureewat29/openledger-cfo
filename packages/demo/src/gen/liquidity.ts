import type { SeedRow } from "../types";
import { ACCOUNT } from "../accounts";
import { fromUnits, toUnits } from "../money";
import { legsOf, row } from "../types";

interface TopUpRule {
  account: string;
  source: string;
  /** Balance that triggers a top-up, and the level it is restored to. */
  floor: number;
  target: number;
  roundTo: number;
  description: string;
}

/**
 * Ordered so that every account is refilled before the account that funds it:
 * each refill is itself an outflow from the source the next rule looks at, so
 * the salary hub is only topped up once the transfers it owes the other six
 * accounts are already in the stream. Modelling refills instead of tuning fixed
 * withdrawal cadences keeps every account solvent whatever the daily draws do.
 */
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

const deltaUnits = (seedRow: SeedRow, account: string): number =>
  legsOf(seedRow).reduce((delta, entry) => {
    if (entry.debit_account === account) return delta + toUnits(entry.amount);
    if (entry.credit_account === account) return delta - toUnits(entry.amount);
    return delta;
  }, 0);

const roundUpTo = (units: number, step: number): number =>
  Math.ceil(units / step) * step;

/**
 * Splices each refill in ahead of the spend that would breach the floor — a batch
 * posts in array order, so same-day dating alone isn't enough. The refill restores the target or covers the outflow, whichever is larger.
 */
const applyRule = (rows: SeedRow[], rule: TopUpRule): SeedRow[] => {
  const floorUnits = toUnits(rule.floor);
  const targetUnits = toUnits(rule.target);
  const stepUnits = toUnits(rule.roundTo);

  const merged: SeedRow[] = [];
  let balanceUnits = 0;

  for (const seedRow of rows) {
    const delta = deltaUnits(seedRow, rule.account);
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

/** Takes the date-sorted stream and returns it with refills spliced in. */
export const applyLiquidity = (rows: SeedRow[]): SeedRow[] =>
  TOP_UP_RULES.reduce<SeedRow[]>(
    (funded, rule) => applyRule(funded, rule),
    rows,
  );
