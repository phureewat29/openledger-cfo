"use client";

import { createContext, useContext, useState } from "react";
import { attemptAsync, isEqual, noop } from "es-toolkit";

import type { Result } from "@openledger-cfo/openledger/result";
import { err, messageOf, ok } from "@openledger-cfo/openledger/result";

import type { RunEntry, RunMode, RunSnapshot } from "~/ingest/run";
import { isRunLive, NO_RUN_ENTRIES, RUN_JOURNAL_CAPACITY } from "~/ingest/run";
import { useHydrated } from "~/lib/ui/use-hydrated";
import { useRingPoll } from "~/lib/ui/use-ring-poll";

/** A live run is worth watching closely; a settled one is checked on, not chased. */
const LIVE_MS = 2000;
const IDLE_MS = 10000;

const RUN_URL = "/api/ingest/run";
const PASSWORD_URL = "/api/ingest/run/password";

interface RunPage {
  readonly entries: RunEntry[];
  readonly latest: number;
  readonly run: RunSnapshot | null;
}

const readRun = async (after: number | undefined): Promise<RunPage> => {
  const query = after === undefined ? "" : `?after=${String(after)}`;
  const response = await fetch(`${RUN_URL}${query}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`The run feed answered ${String(response.status)}`);
  }
  return (await response.json()) as RunPage;
};

/** Every command the page can send the runner answers in one shape. */
type Reply = Result<undefined, string>;

interface RunCommands {
  readonly start: (
    pathOrIds: readonly string[],
    mode: RunMode,
  ) => Promise<Reply>;
  readonly cancel: () => Promise<Reply>;
  /** The password travels in the body and nowhere else — never in this URL. */
  readonly unlock: (
    body: { password: string } | { skip: true },
  ) => Promise<Reply>;
}

const asJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// Every answered command wakes the poll; at the idle pace a press would look missed.
const commandsFor = (wake: () => void): RunCommands => {
  const send = async (url: string, init: RequestInit): Promise<Reply> => {
    const [cause, answer] = await attemptAsync(async () => {
      const response = await fetch(url, init);
      const body = (await response.json()) as { error?: string };
      return { response, body };
    });
    if (answer === null) return err(messageOf(cause));
    wake();
    if (answer.response.ok) return ok(undefined);
    return err(
      answer.body.error ??
        `The runner answered ${String(answer.response.status)}`,
    );
  };

  return {
    start: (pathOrIds, mode) => send(RUN_URL, asJson({ pathOrIds, mode })),
    cancel: () => send(RUN_URL, { method: "DELETE" }),
    unlock: (body) => send(PASSWORD_URL, asJson(body)),
  };
};

interface IngestRun extends RunCommands {
  readonly entries: readonly RunEntry[];
  readonly run: RunSnapshot | null;
  readonly error: string | null;
}

const IngestRunContext = createContext<IngestRun>({
  entries: NO_RUN_ENTRIES,
  run: null,
  error: null,
  // No provider means no poll, so there is nothing to wake.
  ...commandsFor(noop),
});

// One poll for the whole app: the rail's dot and the feed read the same run.
export function IngestRunProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const { entries, error, wake } = useRingPoll({
    read: readRun,
    window: RUN_JOURNAL_CAPACITY,
    empty: NO_RUN_ENTRIES,
    period: run !== null && isRunLive(run.status) ? LIVE_MS : IDLE_MS,
    // A fresh object every poll would re-render the whole app on a timer.
    onPage: (page) =>
      setRun((current) => (isEqual(current, page.run) ? current : page.run)),
  });

  return (
    <IngestRunContext value={{ entries, run, error, ...commandsFor(wake) }}>
      {children}
    </IngestRunContext>
  );
}

// A page can hydrate after the layout's poll lands; until then it sees the server's empty run.
export const useIngestRun = (): IngestRun => {
  const feed = useContext(IngestRunContext);
  const hydrated = useHydrated();
  return hydrated
    ? feed
    : { ...feed, entries: NO_RUN_ENTRIES, run: null, error: null };
};
