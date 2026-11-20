"use client";

import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { attemptAsync, takeRight } from "es-toolkit";

import { messageOf } from "@openledger-cfo/openledger/result";

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

// A restarted server reissues low seqs, so a cursor past the ring's end re-reads the whole ring.
const catchUp = async <P extends RingPage<unknown>>(
  read: (after: number | undefined) => Promise<P>,
  after: number | undefined,
): Promise<CaughtUp<P>> => {
  const page = await read(after);
  if (page.latest >= (after ?? 0)) return { page, whole: undefined };
  return { page, whole: await read(undefined) };
};

/**
 * A settled entry arrives again under its id and takes its earlier slot. The
 * window is the server ring's, so a session never holds more than it remembers.
 */
export const mergeById = <T extends { id: string | number }>(
  current: readonly T[],
  delta: readonly T[],
  window: number,
): T[] => {
  const byId = new Map(
    [...current, ...delta].map((entry) => [entry.id, entry]),
  );
  return takeRight([...byId.values()], window);
};

// Follows a server ring by seq; a hidden tab skips its ticks and reads again when shown.
export function useRingPoll<
  E extends { id: string | number },
  P extends RingPage<E>,
>({
  read,
  window,
  empty,
  period,
  onPage,
}: {
  /** Rejects on failure; the rejection becomes the error line. */
  read: (after: number | undefined) => Promise<P>;
  /** The server ring's capacity. */
  window: number;
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
    const [cause, caught] = await attemptAsync(() =>
      catchUp(read, cursor.current),
    );
    reading.current = false;
    if (caught === null) {
      setError(messageOf(cause));
      return;
    }

    const { page, whole } = caught;
    setError(null);
    onPage?.(page);
    if (whole !== undefined) {
      cursor.current = whole.latest;
      setEntries(whole.entries);
      return;
    }
    cursor.current = page.latest;
    if (page.entries.length === 0) return;
    setEntries((current) => mergeById(current, page.entries, window));
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
