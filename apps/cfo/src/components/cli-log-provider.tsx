"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import type { CliEntry } from "~/domain/cli-log";
import { mergeCliLog, NO_ENTRIES } from "~/domain/cli-log";
import { useTRPC } from "~/trpc/react";

/** Ingest is the one page that watches its own commands land. */
const WATCHING_MS = 2000;
const BASE_MS = 5000;

interface CliLogState {
  readonly entries: readonly CliEntry[];
  readonly error: string | null;
}

const IDLE: CliLogState = { entries: NO_ENTRIES, error: null };

const CliLogContext = createContext<CliLogState>(IDLE);

/**
 * The command ring is read once for the whole app: the status bar and the
 * ingest pane are two views of one poll. Every read asks for what changed since
 * the last one, so an idle tick carries no entries and commits no state.
 */
export function CliLogProvider({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<readonly CliEntry[]>(NO_ENTRIES);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<number | undefined>(undefined);
  const reading = useRef(false);
  const period = usePathname().startsWith("/ingest") ? WATCHING_MS : BASE_MS;

  useEffect(() => {
    const read = (after: number | undefined) =>
      queryClient.fetchQuery(
        trpc.ledger.cliLog.queryOptions(
          after === undefined ? {} : { after },
          // The cursor below is this read's only memory: a stored page would
          // answer the next tick with the delta the last one already applied.
          { gcTime: 0, staleTime: 0 },
        ),
      );

    const poll = async () => {
      if (reading.current || document.hidden) return;
      reading.current = true;
      try {
        const page = await read(cursor.current);
        setError(null);
        // A restarted server issues low seqs again, which leaves the cursor
        // past the end of a ring that no longer holds what it counted.
        if (page.latest < (cursor.current ?? 0)) {
          const whole = await read(undefined);
          cursor.current = whole.latest;
          setEntries(whole.entries);
          return;
        }
        cursor.current = page.latest;
        if (page.entries.length === 0) return;
        setEntries((current) => mergeCliLog(current, page.entries));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading.current = false;
      }
    };

    const resume = () => {
      if (!document.hidden) void poll();
    };

    void poll();
    const ticker = setInterval(() => void poll(), period);
    document.addEventListener("visibilitychange", resume);

    return () => {
      clearInterval(ticker);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [period, queryClient, trpc]);

  const state = useMemo(() => ({ entries, error }), [entries, error]);

  return (
    <CliLogContext.Provider value={state}>{children}</CliLogContext.Provider>
  );
}

export const useCliLog = (): CliLogState => useContext(CliLogContext);
