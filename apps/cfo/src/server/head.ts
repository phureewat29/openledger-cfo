import { cache } from "react";
import { TRPCError } from "@trpc/server";

import type { RouterOutputs } from "@openledger-fleet/api";
import type { Result } from "@openledger-fleet/openledger";
import { err } from "@openledger-fleet/openledger";

import { caller } from "~/trpc/server";

/** An empty ledger and an unreachable one need different words on the page. */
export type LedgerFailureReason = "not-initialized" | "unavailable";

interface LedgerFailure {
  readonly reason: LedgerFailureReason;
  readonly message: string;
}

/**
 * How every server read answers: the value, or why there is none. A reader that
 * only knows something failed has nothing to print but "unavailable", which is
 * the one thing the operator already knows.
 */
export type LedgerLoad<T> = Result<T, LedgerFailure>;

export const toFailure = (error: unknown): LedgerLoad<never> =>
  err({
    reason:
      error instanceof TRPCError && error.code === "PRECONDITION_FAILED"
        ? "not-initialized"
        : "unavailable",
    message: error instanceof Error ? error.message : String(error),
  });

interface LedgerHead {
  readonly status: RouterOutputs["ledger"]["status"];
  /** Newest activity in the ledger; undefined while it holds nothing. */
  readonly newest: string | undefined;
}

/**
 * The two reads the top bar and the dashboard both open on. Each `oled` call
 * spawns a CLI process and they are serialized, so `cache` is what keeps one
 * page from paying for these twice.
 */
export const ledgerHead = cache(async (): Promise<LedgerHead> => {
  const [status, newest] = await Promise.all([
    caller.ledger.status(),
    caller.ledger.transactions.list({ limit: 1 }),
  ]);
  return { status, newest: newest.rows[0]?.date };
});
