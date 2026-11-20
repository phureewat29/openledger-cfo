"use client";

import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";

import type { Result } from "@openledger-cfo/openledger/result";
import { err, messageOf, ok } from "@openledger-cfo/openledger/result";

/** What a server ring answers: the entries past a seq, and its newest seq. */
interface RingPage<E> {
  readonly entries: readonly E[];
  readonly latest: number;
}

interface CaughtUp<P> {
  readonly page: P;
  /** The whole ring, read again when the delta could not be trusted. */
  readonly whole: P | undefined;
}

/**
 * A restarted server issues low seqs again, which leaves the cursor past the
 * end of a ring that no longer holds what it counted: that read starts over
 * from the whole ring.
 */
const catchUp = async <P extends RingPage<unknown>>(
  read: (after: number | undefined) => Promise<P>,
  after: number | undefined,
): Promise<CaughtUp<P>> => {
  const page = await read(after);
  if (page.latest >= (after ?? 0)) return { page, whole: undefined };
  return { page, whole: await read(undefined) };
};

const settle = <T>(promise: Promise<T>): Promise<Result<T, string>> =>
  promise.then(ok, (cause: unknown) => err(messageOf(cause)));

/**
 * Follows a server ring by seq: every read asks for what changed since the
 * last, so an idle tick carries no entries and commits no state. A hidden tab
 * skips its ticks and reads again the moment it shows.
 */
export function useRingPoll<E, P extends RingPage<E>>({
  read,
  merge,
  empty,
  period,
  onPage,
}: {
  /** Rejects on failure; the rejection becomes the error line. */
  read: (after: number | undefined) => Promise<P>;
  merge: (current: readonly E[], delta: readonly E[]) => readonly E[];
  empty: readonly E[];
  period: number;
  /** Sees every page read, for whatever it carries beside its entries. */
  onPage?: (page: P) => void;
}) {
  const [entries, setEntries] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  // Bumping it re-arms the poll below, which reads at once.
  const [wakes, wake] = useReducer((count: number) => count + 1, 0);
  // Bookkeeping no render reads: how far the ring has been read, and whether a read is out.
  const cursor = useRef<number | undefined>(undefined);
  const reading = useRef(false);

  const poll = useEffectEvent(async () => {
    if (reading.current || document.hidden) return;
    reading.current = true;
    const outcome = await settle(catchUp(read, cursor.current));
    reading.current = false;
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }

    const { page, whole } = outcome.value;
    setError(null);
    onPage?.(page);
    if (whole !== undefined) {
      cursor.current = whole.latest;
      setEntries(whole.entries);
      return;
    }
    cursor.current = page.latest;
    if (page.entries.length === 0) return;
    setEntries((current) => merge(current, page.entries));
  });

  useEffect(() => {
    const tick = () => void poll();
    tick();
    const ticker = setInterval(tick, period);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(ticker);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [period, wakes]);

  return { entries, error, wake };
}
