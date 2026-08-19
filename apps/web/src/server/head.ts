import { cache } from "react";

import type { RouterOutputs } from "@openledger-cfo/api";
import type { OledErrorKind, Result } from "@openledger-cfo/openledger";
import { oledCauseOf } from "@openledger-cfo/api";
import { err } from "@openledger-cfo/openledger";

import { caller } from "~/trpc/server";

/** A missing CLI, an empty ledger and an unreachable one each need their own words. */
export type LedgerFailureReason =
  | "not-installed"
  | "not-initialized"
  | "unavailable";

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

const REASON: Partial<Record<OledErrorKind, LedgerFailureReason>> = {
  spawn_failed: "not-installed",
  not_configured: "not-initialized",
};

/**
 * The connector cause's bare message on purpose: the setup card owns the
 * remedy, and the hint the transport folded in would say the command twice.
 */
export const toFailure = (error: unknown): LedgerLoad<never> => {
  const oled = oledCauseOf(error);
  return err({
    reason: (oled && REASON[oled.kind]) ?? "unavailable",
    message:
      oled?.message ?? (error instanceof Error ? error.message : String(error)),
  });
};

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
