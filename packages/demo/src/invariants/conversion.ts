import { sumBy } from "es-toolkit";

import type { Life } from "../dataset";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { toUnits } from "../money";
import { legsOf } from "../types";
import { check, detail } from "./shared";

const FX_RATE_MIN = 33;
const FX_RATE_MAX = 38;

/** A conversion is two legs across two ledgers; only the implied rate can tie them. */
export const conversionCheck = (life: Life, rows: SeedRow[]): Check => {
  const thbConversion = life.accounts.find(
    (account) => account.id === "thb:equity:conversion",
  )?.id;
  const usdConversion = life.accounts.find(
    (account) => account.id === "usd:equity:conversion",
  )?.id;
  const faults: string[] = [];
  let seen = 0;

  for (const seedRow of rows) {
    const legs = legsOf(seedRow);
    const thbUnits = sumBy(
      legs.filter((entry) => entry.debit_account === thbConversion),
      (entry) => toUnits(entry.amount),
    );
    const usdUnits = sumBy(
      legs.filter((entry) => entry.credit_account === usdConversion),
      (entry) => toUnits(entry.amount),
    );
    if (thbUnits === 0 || usdUnits === 0) continue;
    seen += 1;
    const rate = thbUnits / usdUnits;
    if (rate < FX_RATE_MIN || rate > FX_RATE_MAX) {
      faults.push(`${seedRow.date} implies ${rate.toFixed(2)}`);
    }
  }

  return check(
    "currency conversions imply a plausible rate",
    seen > 0 && faults.length === 0,
    detail(faults),
  );
};
