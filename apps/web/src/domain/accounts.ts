import { z } from "zod";

import type { RouterOutputs } from "@openledger-cfo/api";

/**
 * What this app reads out of the ledger's account ids. The id grammar itself
 * (`<currency>:<type>:<group>:<leaf>`, and what counts as a prefix or a
 * category) belongs to the ledger client and is re-exported here, so the page
 * and the briefing can never disagree about what an id means — or about what
 * counts as cash.
 */
export { categoryOf, matchesPrefix } from "@openledger-cfo/openledger/ids";

/** One shape for an account row, derived from the read that produces it. */
export type AccountRow =
  RouterOutputs["ledger"]["accounts"]["list"]["rows"][number];

/** Ids carry the currency lowercased; only display code uppercases it. */
export const PRIMARY = "thb";

/** Spendable this month — what runway and "cash on hand" are measured against. */
export const LIQUID_GROUPS = new Set(["bank", "wallet", "cash"]);

/**
 * The accounts list's "Banks & cash" group, which also shows the USD brokerage
 * cash leg: money the household holds, but not baht runway.
 */
export const CASH_DISPLAY_GROUPS = new Set([...LIQUID_GROUPS, "brokerage"]);

/** A row's currency against the ledger's primary, which ids spell lowercase. */
export const isPrimaryCurrency = (currency: string): boolean =>
  currency.toLowerCase() === PRIMARY;

/**
 * What the ledger records against an account beyond its balance. A position
 * points forward to the ledger that counts its quantity and a unit account
 * points back to the one that holds its cost, so neither side has to be
 * inferred from an id. Anything else the column carries is not this app's to
 * read, and is dropped rather than passed along untyped.
 */
const accountMetadata = z.object({
  kind: z.string().optional(),
  ticker: z.string().optional(),
  /** A scale divides a quantity, so zero and below are not scales. */
  unit_scale: z.number().positive().optional(),
  unit_account: z.string().optional(),
  unit_of: z.string().optional(),
});

type AccountMetadata = Readonly<z.infer<typeof accountMetadata>>;

/** A column written by another process may be anything at all, including nothing. */
const readJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * The CLI hands back the raw column, so reading it is a parse, not a cast — a
 * silently defaulted scale (falling back to 1) would misprice a position by orders of magnitude.
 */
export const parseAccountMetadata = (row: {
  readonly metadata_json: string | null;
}): AccountMetadata | null => {
  if (row.metadata_json === null) return null;
  const parsed = accountMetadata.safeParse(readJson(row.metadata_json));
  return parsed.success ? parsed.data : null;
};

/** The head of an id is its ledger: `apl:asset:position` belongs to `apl`. */
export const headOf = (accountId: string): string =>
  accountId.slice(0, 3).toLowerCase();

/**
 * Heads that count a quantity rather than money. Shares and coins balance in a
 * ledger of their own, so their totals must never join a sum of baht — and an
 * account says which kind it is rather than the reader guessing from the id.
 */
export const unitCurrencies = (
  accounts: readonly {
    readonly id: string;
    readonly metadata_json: string | null;
  }[],
): ReadonlySet<string> =>
  new Set(
    accounts
      .filter((row) => parseAccountMetadata(row)?.kind === "unit")
      .map((row) => headOf(row.id)),
  );

/** The one filter every money figure passes through. */
export const isMoneyCurrency = (
  currency: string,
  units: ReadonlySet<string>,
): boolean => !units.has(currency.toLowerCase());
