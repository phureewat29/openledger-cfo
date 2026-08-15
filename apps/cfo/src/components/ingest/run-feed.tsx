"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@openledger-fleet/ui";
import { Button } from "@openledger-fleet/ui/button";
import { Input } from "@openledger-fleet/ui/input";
import { Pane } from "@openledger-fleet/ui/pane";

import type { RunEntry, RunEntryKind, RunStatus } from "~/domain/ingest-run";
import {
  cancelIngestRun,
  unlockIngestRun,
  useIngestRun,
} from "~/components/ingest-run-provider";
import { useSelection } from "~/components/ingest/selection";
import { LoadingLine } from "~/components/loading-line";
import { useHydrated } from "~/components/use-hydrated";
import { isRunLive, NO_RUN_ENTRIES, runLine } from "~/domain/ingest-run";

/** Below this the reader is at the tail and new steps should follow. */
const STUCK_PX = 40;

const STATUS_META: Record<RunStatus, string> = {
  running: "working",
  "waiting-password": "locked",
  done: "finished",
  failed: "stopped",
  cancelled: "cancelled",
};

const ENTRY_TONE: Record<RunEntryKind, string> = {
  tool: "text-muted-foreground",
  note: "text-muted-foreground",
  error: "text-destructive",
  ask: "text-accent",
  summary: "text-foreground",
};

function Pulse({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      className="bg-accent size-1.5 shrink-0 animate-pulse rounded-full"
    />
  );
}

function EntryRow({ entry }: { entry: RunEntry }) {
  const { view } = useSelection();
  const { fileId } = entry;
  const text = runLine(entry.label, entry.detail);

  if (entry.kind === "summary") {
    return (
      <li className="border-accent/40 text-foreground my-1 border-l-2 pl-2 text-[11px] leading-4 whitespace-pre-wrap">
        {entry.label}
      </li>
    );
  }

  return (
    <li className={cn("flex items-baseline gap-1.5", ENTRY_TONE[entry.kind])}>
      <span className="min-w-0 flex-1 text-[10px]">{text}</span>
      {fileId === undefined ? null : (
        <button
          type="button"
          /* An ask is about something the ledger wants answered; the others
             are about the file itself. Each opens the face it talks about. */
          onClick={() =>
            view(fileId, entry.kind === "ask" ? "questions" : "document")
          }
          title="Open in Info"
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer text-[10px] underline decoration-dotted"
        >
          Open
        </button>
      )}
      {entry.running === true ? <Pulse label="Running" /> : null}
    </li>
  );
}

function LockPanel({ relPath }: { relPath: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (body: { password: string } | { skip: true }) => {
    setBusy(true);
    const result = await unlockIngestRun(body);
    setPassword("");
    setBusy(false);
    setError(result.ok ? null : result.message);
  };

  return (
    <div className="border-border shrink-0 border-t px-3 py-2">
      <p className="text-muted-foreground pb-1 text-[10px]">
        {relPath} is locked. Enter its password to let the run finish it.
      </p>
      <div className="flex gap-1">
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Document password"
          aria-label="Document password"
          className="h-7 min-w-0 flex-1 text-xs"
        />
        <Button
          size="sm"
          className="h-7 px-2"
          disabled={password.length === 0 || busy}
          onClick={() => void submit({ password })}
        >
          Submit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={busy}
          onClick={() => void submit({ skip: true })}
        >
          Skip
        </Button>
      </div>
      {error === null ? null : (
        <p className="text-destructive pt-1 text-[10px]">{error}</p>
      )}
    </div>
  );
}

export function RunFeed({
  enabled,
  className,
}: {
  enabled: boolean;
  className?: string;
}) {
  const hydrated = useHydrated();
  const feed = useIngestRun();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stuckRef = useRef(true);

  /**
   * Gated on hydrated, not just on what the poll holds: the provider polls from
   * the layout, outside this page's boundary, so it can already hold a run
   * before this subtree hydrates — rendering it then would diverge from the
   * empty server HTML.
   */
  const entries = hydrated ? feed.entries : NO_RUN_ENTRIES;
  const run = hydrated ? feed.run : null;
  const live = run !== null && isRunLive(run.status);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || !stuckRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [entries]);

  const body = () => {
    if (!enabled) {
      return (
        <p className="text-muted-foreground text-xs">
          Set{" "}
          <code className="text-foreground">OPENAI_COMPATIBLE_BASE_URL</code>{" "}
          and <code className="text-foreground">OPENAI_COMPATIBLE_API_KEY</code>{" "}
          to let the agent work the queue. Every file can still be prepared and
          closed by hand from the list.
        </p>
      );
    }
    // The provider may already hold a live run; claiming idle before the gate
    // opens would be a lie for a frame.
    if (!hydrated) return <LoadingLine />;
    if (entries.length === 0) {
      return (
        <p className="text-muted-foreground text-xs">
          Nothing has run yet. Drop a statement and press Ingest all.
        </p>
      );
    }
    return (
      <ul className="leading-4">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
    );
  };

  return (
    <Pane
      title="Run"
      /* The mode rides along because it changes what "finished" means: an auto
         run answered the questions, a normal run left them for the operator. */
      meta={
        !hydrated
          ? undefined
          : run === null
            ? "idle"
            : runLine(run.mode, STATUS_META[run.status])
      }
      actions={
        !live ? null : (
          <span className="flex items-center gap-2">
            {run.status === "running" ? (
              <Pulse label="Run in progress" />
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-5 px-1.5 text-[10px]"
              onClick={() => void cancelIngestRun()}
            >
              Cancel
            </Button>
          </span>
        )
      }
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
    >
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stuckRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <=
            STUCK_PX;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {feed.error === null ? null : (
          <p className="text-destructive pb-1 text-[10px]">{feed.error}</p>
        )}
        {body()}
      </div>

      {run?.waiting === undefined ? null : (
        <LockPanel relPath={run.waiting.relPath} />
      )}
    </Pane>
  );
}
