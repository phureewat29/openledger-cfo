import { attempt, compact, sumBy } from "es-toolkit";
import { z } from "zod/v4";

import type { AccountRow, Status } from "@openledger-cfo/openledger";

// The id grammar belongs to the ledger client; one re-export keeps every reader on it.
export { categoryOf, matchesPrefix } from "@openledger-cfo/openledger/ids";

export type { AccountRow };

/** Ids carry the currency lowercased; only display code uppercases it. */
export const PRIMARY = "thb";

export const segmentOf = (accountId: string, index: number) =>
  accountId.split(":")[index] ?? "";

export type AccountKind = "card" | "loan" | "cash" | "position" | "basic";

/**
 * `<type>:<third segment>`, the ledger's own taxonomy. `cash` is what is
 * spendable this month: what runway and "cash on hand" are measured against.
 */
const ACCOUNT_KIND: Readonly<Record<string, AccountKind>> = {
  "liability:credit_card": "card",
  "liability:loan": "loan",
  "asset:bank": "cash",
  "asset:wallet": "cash",
  "asset:cash": "cash",
  "asset:stock": "position",
  "asset:etf": "position",
  "asset:fund": "position",
  "asset:crypto": "position",
  "asset:investment": "position",
};

export const accountKindOf = (row: {
  readonly type: string;
  readonly id: string;
}): AccountKind =>
  ACCOUNT_KIND[`${row.type}:${segmentOf(row.id, 2)}`] ?? "basic";

/** Leaves hold the balances; a parent carries none of its own. */
export const leavesOf = <
  A extends { readonly id: string; readonly parent_id: string | null },
>(
  accounts: readonly A[],
): A[] => {
  const parents = new Set(compact(accounts.map((row) => row.parent_id)));
  return accounts.filter((row) => !parents.has(row.id));
};

/** Expense groups nobody can decide their way out of in a single month. */
export const COMMITTED_GROUPS: ReadonlySet<string> = new Set([
  "donation",
  "family",
  "fees",
  "health",
  "housing",
  "insurance",
  "interest",
  "tax",
  "utilities",
]);

/** A row's currency against the ledger's primary, which ids spell lowercase. */
export const isPrimaryCurrency = (currency: string): boolean =>
  currency.toLowerCase() === PRIMARY;

export interface BalanceSheet {
  readonly netWorthThb: number;
  readonly netWorthUsd: number;
  /** Baht cards and loans only, as a positive magnitude: it is added to `netWorthThb`. */
  readonly liabilities: number;
}

/** The ledger's own net worth per currency, and what the baht leaves owe. */
export const balanceSheetOf = (
  status: Status,
  leaves: readonly {
    readonly id: string;
    readonly type: string;
    readonly currency: string;
    readonly balance: number;
  }[],
): BalanceSheet => ({
  netWorthThb: status.net_worth?.net_worth.THB ?? 0,
  netWorthUsd: status.net_worth?.net_worth.USD ?? 0,
  liabilities: sumBy(
    leaves.filter(
      (row) =>
        row.id.startsWith(`${PRIMARY}:`) &&
        row.type === "liability" &&
        isPrimaryCurrency(row.currency),
    ),
    (row) => row.balance,
  ),
});

/**
 * A position points to the ledger counting its quantity, and a unit account back to
 * its cost, so neither is inferred from an id. Other keys are dropped, not passed untyped.
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

/**
 * The CLI hands back the raw column, so reading it is a parse, not a cast — a
 * silently defaulted scale (falling back to 1) would misprice a position by orders of magnitude.
 */
export const parseAccountMetadata = (row: {
  readonly metadata_json: string | null;
}): AccountMetadata | null => {
  const { metadata_json } = row;
  if (metadata_json === null) return null;
  const [, json] = attempt<unknown, unknown>(() => JSON.parse(metadata_json));
  const parsed = accountMetadata.safeParse(json);
  return parsed.success ? parsed.data : null;
};

export const accountHref = (accountId: string): string =>
  `/accounts/${encodeURIComponent(accountId)}`;

/** The head of an id is its ledger: `apl:asset:position` belongs to `apl`. */
const headOf = (accountId: string): string =>
  accountId.slice(0, 3).toLowerCase();

/** Heads whose ledgers count shares and coins, never money; the account says so, not the id. */
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

/** A unit ledger's legs are quantities, so they never join a sum of money. */
export const isMoneyRow = (
  row: { readonly currency: string; readonly debit_account_id: string },
  units: ReadonlySet<string>,
): boolean =>
  isMoneyCurrency(row.currency, units) &&
  isMoneyCurrency(headOf(row.debit_account_id), units);

/** Segments whose title-cased form reads wrong. */
const SEGMENT_LABELS: Record<string, string> = {
  "credit-card": "Credit card",
  donation: "Donations",
  entertainment: "Entertainment",
  fees: "Bank fees",
  family: "Family support",
  food: "Food & dining",
  interest: "Loan interest",
  subscriptions: "Subscriptions",
  tax: "Tax & social security",
  "bts-mrt": "BTS / MRT",
  "condo-fee": "Condo fee",
  "income-tax": "Income tax",
  "kbank-visa": "KBank Visa",
  "real-estate": "Real estate",
  "social-security": "Social security",
  credit_card: "Credit cards",
  etf: "ETFs",
  fx: "FX",
  kbank: "KBank",
  pvd: "Provident fund",
  rmf: "RMF",
  rsu: "RSUs",
  scb: "SCB",
  ssf: "SSF",
  truemoney: "TrueMoney",
  ttb: "ttb",
  uob: "UOB",
};

const titleCase = (segment: string) =>
  segment
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * The ledger already names every account, so a caller with the row in hand
 * should pass it; the table only rescues ids read straight off a transaction.
 */
export const accountLabel = (
  accountId: string,
  name?: string | null,
): string => {
  if (name && name.length > 0) return name;
  const segment = accountId.slice(accountId.lastIndexOf(":") + 1);
  return SEGMENT_LABELS[segment] ?? titleCase(segment);
};
