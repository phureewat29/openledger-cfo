"use client";

import { useState } from "react";

import { useHydrated } from "~/components/use-hydrated";

/** One corgi at work per load; the ledger jokes stay dry and short. */
const PHRASES = [
  "Reading the ledger…",
  "Counting every satang…",
  "Balancing debits against credits…",
  "Asking the ledger nicely…",
  "Summing two years of statements…",
  "Walking the account tree…",
  "Chasing the money trail…",
  "Sniffing out the balances…",
  "Herding transactions into rows…",
  "Fetching the books…",
  "Doing the double entry, twice…",
  "Squaring the books…",
  "Waking the ledger…",
  "Totting up the totals…",
  "Following the paper trail…",
  "Digging up buried figures…",
  "Rolling up the account tree…",
  "Checking both sides of every coin…",
  "Poking the CLI…",
  "Wagging through the rows…",
  "Counting on both paws…",
  "Reconciling the runway…",
  "Reading last month twice…",
  "Lining up the decimal points…",
  "Interrogating the subscriptions…",
  "Pulling the statements apart…",
  "Stacking satang into baht…",
  "Auditing the coffee budget…",
  "Trotting through the postings…",
  "Opening the books gently…",
  "Re-adding the additions…",
  "Consulting the equity accounts…",
  "Measuring the month so far…",
  "Weighing assets against debts…",
  "Untangling the transfers…",
  "Reading the fine print…",
  "Carrying the one…",
  "Sharpening the pencils…",
  "Rounding to the nearest satang…",
  "Warming up the calculator…",
  "Sorting rows by date, again…",
  "Verifying the double entries…",
  "Peeking at the balances…",
  "Combing through the merchants…",
  "Tracking every last baht…",
  "Replaying the money story…",
  "Adding up what moved…",
  "Asking where the money went…",
  "Fetching figures, tail wagging…",
  "Balancing the books before breakfast…",
] as const;

const FALLBACK = PHRASES[0];

/**
 * Server render and first client paint agree on the fallback; the random pick
 * shows once hydration says the client owns the frame.
 */
export function LoadingLine() {
  const hydrated = useHydrated();
  const [phrase] = useState<string>(
    () => PHRASES[Math.floor(Math.random() * PHRASES.length)] ?? FALLBACK,
  );

  return (
    <p
      className={
        "animate-[shimmer-sweep_2.4s_linear_infinite] " +
        "bg-[linear-gradient(90deg,var(--color-muted-foreground)_38%,var(--color-accent)_50%,var(--color-muted-foreground)_62%)] " +
        "bg-[length:200%_100%] bg-clip-text text-xs text-transparent"
      }
    >
      {hydrated ? phrase : FALLBACK}
    </p>
  );
}
