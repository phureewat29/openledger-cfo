import type { Life } from "../dataset";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { toUnits } from "../money";
import { legsOf } from "../types";
import { check } from "./shared";

export const cryptoBasisCheck = (life: Life, rows: SeedRow[]): Check => {
  const coins = new Set(life.meta.products.coins.map((coin) => coin.account));
  const basis = new Map<string, number>();
  const faults: string[] = [];

  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      if (coins.has(entry.debit_account)) {
        const account = entry.debit_account;
        basis.set(account, (basis.get(account) ?? 0) + units);
      }
      if (!coins.has(entry.credit_account)) continue;
      const account = entry.credit_account;
      const held = basis.get(account) ?? 0;
      if (units > held) {
        faults.push(
          `${seedRow.date} ${account} sells more basis than it holds`,
        );
      }
      basis.set(account, held - units);
    }
  }

  return check(
    "crypto disposals never exceed cost basis",
    faults.length === 0,
    faults.slice(0, 3).join(" · "),
  );
};
