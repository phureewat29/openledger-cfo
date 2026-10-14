import type { Life } from "../dataset";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { deltasOf } from "../types";
import { check, detail } from "./shared";

export const cryptoBasisCheck = (life: Life, rows: SeedRow[]): Check => {
  const coins = new Set(life.meta.products.coins.map((coin) => coin.account));
  const basis = new Map<string, number>();
  const faults: string[] = [];

  for (const seedRow of rows) {
    for (const [account, units] of deltasOf(seedRow, coins)) {
      const held = basis.get(account) ?? 0;
      basis.set(account, held + units);
      if (units < 0 && -units > held) {
        faults.push(
          `${seedRow.date} ${account} sells more basis than it holds`,
        );
      }
    }
  }

  return check(
    "crypto disposals never exceed cost basis",
    coins.size > 0 && faults.length === 0,
    detail(faults),
  );
};
