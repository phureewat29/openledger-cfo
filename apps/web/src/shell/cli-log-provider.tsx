"use client";

import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import type { CliEntry } from "~/shell/cli-log";
import { useHydrated } from "~/lib/ui/use-hydrated";
import { useRingPoll } from "~/lib/ui/use-ring-poll";
import { CLI_LOG_WINDOW, NO_ENTRIES } from "~/shell/cli-log";
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

// One poll for the whole app: the status bar and the ingest pane read the same ring.
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
    window: CLI_LOG_WINDOW,
    empty: NO_ENTRIES,
    period,
  });

  return <CliLogContext value={{ entries, error }}>{children}</CliLogContext>;
}

// A page can hydrate after the layout's poll lands; until then it sees the server's empty log.
export const useCliLog = (): CliLogState => {
  const log = useContext(CliLogContext);
  const hydrated = useHydrated();
  return hydrated ? log : IDLE;
};
