"use client";

import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import type { CliEntry } from "~/domain/cli-log";
import { useRingPoll } from "~/components/use-ring-poll";
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
 * ingest pane are two views of one poll.
 */
export function CliLogProvider({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const period = usePathname().startsWith("/ingest") ? WATCHING_MS : BASE_MS;
  const { entries, error } = useRingPoll({
    read: (after) =>
      queryClient.fetchQuery(
        trpc.ledger.cliLog.queryOptions(
          after === undefined ? {} : { after },
          // The poll's cursor is this read's only memory: a stored page would
          // answer the next tick with the delta the last one already applied.
          { gcTime: 0, staleTime: 0 },
        ),
      ),
    merge: mergeCliLog,
    empty: NO_ENTRIES,
    period,
  });

  return (
    <CliLogContext.Provider value={{ entries, error }}>
      {children}
    </CliLogContext.Provider>
  );
}

export const useCliLog = (): CliLogState => useContext(CliLogContext);
