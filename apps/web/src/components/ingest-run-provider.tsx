"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isEqual } from "es-toolkit";

import type { RunEntry, RunMode, RunSnapshot } from "~/domain/ingest-run";
import {
  isRunLive,
  mergeRunEntries,
  NO_RUN_ENTRIES,
} from "~/domain/ingest-run";

/** A live run is worth watching closely; a settled one is checked on, not chased. */
const LIVE_MS = 2000;
const IDLE_MS = 10000;

const RUN_URL = "/api/ingest/run";
const PASSWORD_URL = "/api/ingest/run/password";

interface IngestRunState {
  readonly entries: readonly RunEntry[];
  readonly run: RunSnapshot | null;
  readonly error: string | null;
}

const IDLE: IngestRunState = {
  entries: NO_RUN_ENTRIES,
  run: null,
  error: null,
};

const IngestRunContext = createContext<IngestRunState>(IDLE);

interface RunPage {
  readonly entries: RunEntry[];
  readonly latest: number;
  readonly run: RunSnapshot | null;
}

export type RunCommand =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * The mounted provider's read, so a command can pull the next one forward: at
 * the idle pace a press of Ingest would sit there for ten seconds looking
 * like it missed.
 */
const readers = new Set<() => void>();

/** Every command the page can send the runner answers in one shape. */
const send = async (url: string, init: RequestInit): Promise<RunCommand> => {
  try {
    const response = await fetch(url, init);
    const body = (await response.json()) as { error?: string };
    // Refused or accepted, the run is not where the last poll left it.
    for (const read of readers) read();
    if (response.ok) return { ok: true };
    return {
      ok: false,
      message: body.error ?? `The runner answered ${String(response.status)}`,
    };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
};

const asJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A run is always asked for by name; there is no whole-queue scope anywhere. */
export interface RunScopeInput {
  readonly pathOrIds: readonly string[];
}

export const startIngestRun = (
  scope: RunScopeInput,
  mode: RunMode,
): Promise<RunCommand> => send(RUN_URL, asJson({ ...scope, mode }));

export const cancelIngestRun = (): Promise<RunCommand> =>
  send(RUN_URL, { method: "DELETE" });

/** The password travels in the body and nowhere else — never in this URL. */
export const unlockIngestRun = (
  body: { password: string } | { skip: true },
): Promise<RunCommand> => send(PASSWORD_URL, asJson(body));

/**
 * The run is read once for the whole app, from the root layout: the rail's dot
 * and the feed are two views of one poll, and a run keeps reporting while the
 * operator is on another page. Every read asks for what changed since the last,
 * so an idle tick carries no entries and commits no state.
 */
export function IngestRunProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<readonly RunEntry[]>(NO_RUN_ENTRIES);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<number | undefined>(undefined);
  const reading = useRef(false);
  const period = run !== null && isRunLive(run.status) ? LIVE_MS : IDLE_MS;

  useEffect(() => {
    const read = async (after: number | undefined): Promise<RunPage> => {
      const query = after === undefined ? "" : `?after=${String(after)}`;
      const response = await fetch(`${RUN_URL}${query}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`The run feed answered ${String(response.status)}`);
      }
      return (await response.json()) as RunPage;
    };

    const poll = async () => {
      if (reading.current || document.hidden) return;
      reading.current = true;
      try {
        const page = await read(cursor.current);
        setError(null);
        // A fresh object every poll would re-render the whole app on a timer.
        setRun((current) => (isEqual(current, page.run) ? current : page.run));
        // A restarted server's seqs start low again, so a carried-over cursor outruns the new ring.
        if (page.latest < (cursor.current ?? 0)) {
          const whole = await read(undefined);
          cursor.current = whole.latest;
          setEntries(whole.entries);
          return;
        }
        cursor.current = page.latest;
        if (page.entries.length === 0) return;
        setEntries((current) => mergeRunEntries(current, page.entries));
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
    readers.add(resume);

    return () => {
      clearInterval(ticker);
      document.removeEventListener("visibilitychange", resume);
      readers.delete(resume);
    };
  }, [period]);

  const state = useMemo(() => ({ entries, run, error }), [entries, run, error]);

  return (
    <IngestRunContext.Provider value={state}>
      {children}
    </IngestRunContext.Provider>
  );
}

export const useIngestRun = (): IngestRunState => useContext(IngestRunContext);
