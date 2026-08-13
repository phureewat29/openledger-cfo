import { cache } from "react";

import { ok } from "@openledger-fleet/openledger";

import type { LedgerLoad } from "~/server/head";
import { overdueCount } from "~/domain/action";
import { isoToday, monthOf } from "~/domain/period";
import { ledgerHead, toFailure } from "~/server/head";
import { caller } from "~/trpc/server";

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
export const NO_BADGES: RailBadges = { monitor: 0, ingest: 0 };

/** Enough for the chrome; the panes load their own data. */
export const loadChrome = cache(async (): Promise<LedgerLoad<Chrome>> => {
  const today = isoToday();
  try {
    const { status, newest } = await ledgerHead();
    // Clamped like the dashboard's, so both sides run the same staleness test.
    const asOf = newest !== undefined && newest < today ? newest : today;
    return ok({
      asOf,
      stale: monthOf(asOf) !== monthOf(today),
      transactions: status.counts?.transactions ?? 0,
      accounts: status.counts?.accounts ?? 0,
    });
  } catch (error) {
    return toFailure(error);
  }
});

/**
 * The rail renders on every route, so it may only read what the chrome already
 * paid for: `ledgerHead` is shared with `loadChrome`, and reminders come from
 * Postgres rather than another `oled` process.
 */
export const loadRailBadges = cache(
  async (): Promise<LedgerLoad<RailBadges>> => {
    try {
      const [{ status }, reminders] = await Promise.all([
        ledgerHead(),
        caller.reminders.list(),
      ]);
      return ok({
        monitor: overdueCount(reminders, isoToday()),
        ingest:
          status.files.new +
          status.files.failed +
          (status.questions?.open ?? 0),
      });
    } catch (error) {
      return toFailure(error);
    }
  },
);
