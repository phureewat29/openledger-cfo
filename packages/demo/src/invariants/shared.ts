import { sumBy } from "es-toolkit";

import type { AccountType } from "@openledger-cfo/openledger";

import type { Life } from "../dataset";
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

/** The first few faults, joined for display; empty when there are none. */
export const detail = (faults: readonly string[], fallback = ""): string =>
  faults.slice(0, 3).join(" · ") || fallback;

/** Every charted account's own type, by id. */
export const typeOf = (life: Life): Map<string, AccountType> =>
  new Map(life.accounts.map((account) => [account.id, account.type] as const));

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
