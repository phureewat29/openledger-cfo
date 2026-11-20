import { cache } from "react";

import { caller } from "@openledger-cfo/api";
import { unwrapOr } from "@openledger-cfo/openledger/result";

import type { LedgerLoad } from "~/ledger/load";
import { asLedgerLoad, ledgerHead } from "~/ledger/load";
import { asOfFor, isoToday, isStale } from "~/ledger/period";
import { overdueCount } from "~/plan/upcoming";

export interface Chrome {
  readonly asOf: string;
  readonly stale: boolean;
  readonly transactions: number;
  readonly accounts: number;
}

export interface RailBadges {
  readonly monitor: number;
  readonly ingest: number;
}

/** What the rail shows when there is no ledger to count against. */
const NO_BADGES: RailBadges = { monitor: 0, ingest: 0 };

/** Enough for the chrome; the panes load their own data. */
export const loadChrome = cache((): Promise<LedgerLoad<Chrome>> => {
  const today = isoToday();
  return asLedgerLoad(
    ledgerHead().then(({ status, newest }) => {
      const asOf = asOfFor(newest, today);
      return {
        asOf,
        stale: isStale(asOf, today),
        transactions: status.counts?.transactions ?? 0,
        accounts: status.counts?.accounts ?? 0,
      };
    }),
  );
});

/**
 * The rail renders on every route, so it reads only what the chrome already
 * paid for (`ledgerHead`) and the control plane, never another `oled` process.
 */
export const loadRailBadges = cache(async (): Promise<RailBadges> =>
  unwrapOr(
    await asLedgerLoad(
      Promise.all([ledgerHead(), caller.reminders.list()]).then(
        ([{ status }, reminders]) => ({
          monitor: overdueCount(reminders, isoToday()),
          ingest:
            status.files.new +
            status.files.failed +
            (status.questions?.open ?? 0),
        }),
      ),
    ),
    NO_BADGES,
  ),
);
