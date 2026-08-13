import { sumBy } from "es-toolkit";

import type { SeedRow } from "../types";
import { toUnits } from "../money";
import { legsOf } from "../types";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export const check = (name: string, ok: boolean, detail = ""): Check => ({
  name,
  ok,
  detail,
});

export const legUnits = (
  rows: SeedRow[],
  side: "debit" | "credit",
  account: string,
): number =>
  sumBy(
    rows.flatMap((seedRow) =>
      legsOf(seedRow).filter((entry) =>
        side === "debit"
          ? entry.debit_account === account
          : entry.credit_account === account,
      ),
    ),
    (entry) => toUnits(entry.amount),
  );

export const linkedGroupsCrediting = (
  rows: SeedRow[],
  account: string,
): SeedRow[] =>
  rows.filter(
    (seedRow) =>
      "linked" in seedRow &&
      seedRow.linked.some((entry) => entry.credit_account === account),
  );
