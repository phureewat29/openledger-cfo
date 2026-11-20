import type { AccountType } from "@openledger-cfo/openledger";

import type { Life } from "../dataset";

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

export const typeOf = (life: Life): Map<string, AccountType> =>
  new Map(life.accounts.map((account) => [account.id, account.type] as const));
