import { cache } from "react";

import type { OledErrorKind, Result, Status } from "@openledger-cfo/openledger";
import { caller, oledCauseOf } from "@openledger-cfo/api";
import { err, messageOf, ok } from "@openledger-cfo/openledger";

import type { AccountRow } from "./accounts";
import type { Posting, TransactionRow } from "./postings";
import { isMoneyRow, leavesOf, unitCurrencies } from "./accounts";
import { asOfFor, isoToday, windowOf } from "./period";
import { toPostings } from "./postings";

/** A missing CLI, an outdated one, an empty ledger and an unreachable one each need their own words. */
export type LedgerFailureReason =
  "not-installed" | "outdated" | "not-initialized" | "unavailable";

interface LedgerFailure {
  readonly reason: LedgerFailureReason;
  readonly message: string;
}

/** How every server read answers: the value, or the reason there is none. */
export type LedgerLoad<T> = Result<T, LedgerFailure>;

const REASON: Partial<Record<OledErrorKind, LedgerFailureReason>> = {
  spawn_failed: "not-installed",
  contract_mismatch: "outdated",
  not_configured: "not-initialized",
};

// The cause's bare message: the setup card owns the remedy, so the transport's hint would say it twice.
const toFailure = (error: unknown): LedgerLoad<never> => {
  const oled = oledCauseOf(error);
  return err({
    reason: (oled && REASON[oled.kind]) ?? "unavailable",
    message: oled?.message ?? messageOf(error),
  });
};

/** A server read as a value: whatever it throws becomes the reason it has none. */
export const asLedgerLoad = <T>(read: Promise<T>): Promise<LedgerLoad<T>> =>
  read.then((value) => ok(value), toFailure);

interface LedgerHead {
  readonly status: Status;
  /** Newest activity in the ledger; undefined while it holds nothing. */
  readonly newest: string | undefined;
}

/** The chrome and the dashboard both open on these; `cache` keeps a page from spawning them twice. */
export const ledgerHead = cache(async (): Promise<LedgerHead> => {
  const [status, newest] = await Promise.all([
    caller.ledger.status(),
    caller.ledger.transactions.list({ limit: 1 }),
  ]);
  return { status, newest: newest.rows[0]?.date };
});

export interface LedgerWindow {
  readonly today: string;
  /** Where the ledger's story ends; every trailing window is measured back from it. */
  readonly asOf: string;
  readonly status: Status;
  readonly accounts: readonly AccountRow[];
  /** Heads that count shares and coins, whose legs never join a sum of money. */
  readonly units: ReadonlySet<string>;
  readonly leaves: readonly AccountRow[];
  /** The trailing window's rows, unit legs dropped. */
  readonly transactions: readonly TransactionRow[];
  readonly postings: readonly Posting[];
}

/** The reads every ledger page opens on, once per request. */
export const ledgerWindow = cache(async (): Promise<LedgerWindow> => {
  const today = isoToday();
  const [{ status, newest }, accounts] = await Promise.all([
    ledgerHead(),
    caller.ledger.accounts.list(),
  ]);
  const asOf = asOfFor(newest, today);
  const rows = await caller.ledger.transactions.listAll({
    from: windowOf(asOf).from,
    to: asOf,
  });
  const units = unitCurrencies(accounts.rows);
  const transactions = rows.filter((row) => isMoneyRow(row, units));
  return {
    today,
    asOf,
    status,
    accounts: accounts.rows,
    units,
    leaves: leavesOf(accounts.rows),
    transactions,
    postings: toPostings(transactions),
  };
});
