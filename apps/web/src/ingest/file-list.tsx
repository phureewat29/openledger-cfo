"use client";

import { useState } from "react";
import { useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { sumBy } from "es-toolkit";

import { Button } from "@openledger-cfo/ui/button";
import { Pane } from "@openledger-cfo/ui/pane";

import type { FileActionKind, IngestCounts, IngestFile } from "~/ingest/files";
import type { RunMode } from "~/ingest/run";
import { Dropzone } from "~/ingest/dropzone";
import { FileRow } from "~/ingest/file-row";
import {
  actionsFor,
  isLocked,
  openCountOf,
  openQuestionsByFile,
} from "~/ingest/files";
import { ModeDialog } from "~/ingest/mode-dialog";
import { isRunLive, runLine } from "~/ingest/run";
import { useIngestRun } from "~/ingest/run-provider";
import { useQueueRefresh, useSelection } from "~/ingest/selection";
import { countNoun } from "~/lib/format";
import { LoadingLine } from "~/lib/ui/loading-line";
import { RemoveButton } from "~/lib/ui/remove-button";
import { useTRPC, useTRPCClient } from "~/trpc/react";

// The fast pace is for a queue somebody is working through; a settled one is watched.
const WORKING_MS = 3000;
const IDLE_MS = 15000;

const paceOf = (summary: IngestCounts | null | undefined, working: boolean) =>
  working || (summary?.new ?? 0) + (summary?.pending ?? 0) > 0
    ? WORKING_MS
    : IDLE_MS;

const ACTION_LABEL: Record<FileActionKind, (count: number) => string> = {
  ingest: (count) => `Ingest (${String(count)})`,
  done: (count) => `Close (${String(count)})`,
  delete: (count) => `Delete (${String(count)})`,
};

/** Both write the ledger or the disk; neither moves without a second look. */
type ConfirmKind = Exclude<FileActionKind, "ingest">;

interface Confirming {
  readonly kind: ConfirmKind;
  readonly targets: readonly IngestFile[];
}

const CONFIRM: Record<
  ConfirmKind,
  { ask: (count: number) => string; verb: string; busy: string }
> = {
  done: {
    ask: (count) =>
      `Close ${countNoun(count, "file")}? Each is recorded in the ledger as ingested.`,
    verb: "Close",
    busy: "Closing…",
  },
  delete: {
    ask: (count) =>
      `Delete ${countNoun(count, "file")}? Rows and questions the ledger recorded for them go too.`,
    verb: "Delete",
    busy: "Deleting…",
  },
};

/** Without a key the agent cannot run; closing and removing by hand still can. */
const NEEDS_AGENT: Record<FileActionKind, boolean> = {
  ingest: true,
  done: false,
  delete: false,
};

const countPart = (value: number, label: string) =>
  value > 0 ? `${String(value)} ${label}` : undefined;

/** Error lines shown in full before the strip folds into a count. */
const SHOWN_ERROR_LINES = 3;

// Closed files are left out: their count only grows and would crowd out what is still work.
const countsOf = (summary: IngestCounts | null | undefined, rows: number) => {
  if (summary === null || summary === undefined) return countNoun(rows, "file");
  const counts = runLine(
    countPart(summary.new, "new"),
    countPart(summary.pending, "pending"),
    countPart(summary.failed, "discarded"),
    countPart(summary.unreadable, "unreadable"),
  );
  if (counts.length > 0) return counts;
  return summary.ingested === 0 ? "empty" : `${String(summary.ingested)} done`;
};

/** What the run route is asked for, held while the mode dialog is open. */
type PendingRun = readonly string[];

const removeFile = async (row: IngestFile): Promise<string | null> => {
  const response = await fetch("/api/ingest/file", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      relPath: row.rel_path,
      status: row.status,
      fileId: row.file_id ?? undefined,
    }),
  });
  if (response.ok) return null;
  const body = (await response.json()) as { error?: string };
  return runLine(
    row.rel_path,
    body.error ?? `answered ${String(response.status)}`,
  );
};

export function FileList({
  enabled,
  className,
}: {
  enabled: boolean;
  className?: string;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const refresh = useQueueRefresh();
  const { run, start } = useIngestRun();
  const { selected, selectAll, clear, view } = useSelection();
  const [pending, setPending] = useState<PendingRun | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [errors, setErrors] = useState<readonly string[]>([]);

  // Every mutation this page can run rewrites one of these two reads.
  const working = useIsMutating() > 0;
  const query = useQuery(
    trpc.ledger.ingest.list.queryOptions(undefined, {
      refetchInterval: (files) => paceOf(files.state.data?.summary, working),
    }),
  );
  // The one poller for this key: the info pane rides the same cache entry.
  const questions = useQuery(
    trpc.ledger.questions.list.queryOptions(
      {},
      { refetchInterval: working ? WORKING_MS : IDLE_MS },
    ),
  );

  const rows = query.data?.rows ?? [];
  const openQuestions = openQuestionsByFile(questions.data?.rows ?? []);
  const live = run !== null && isRunLive(run.status);

  /** What a confirmed press does to one file: null when it landed, else why not. */
  const act: Record<ConfirmKind, (row: IngestFile) => Promise<string | null>> =
    {
      done: async (row) => {
        if (row.file_id === null) return null;
        const closed = await client.ledger.ingest.done.mutate({
          fileId: row.file_id,
        });
        return closed.ok ? null : runLine(row.rel_path, closed.message);
      },
      delete: removeFile,
    };

  const confirm = useMutation({
    mutationFn: async ({ kind, targets }: Confirming) => {
      const failures: string[] = [];
      for (const row of targets) {
        const failure = await act[kind](row);
        if (failure !== null) failures.push(failure);
      }
      return failures;
    },
    onSuccess: (failures) => {
      refresh();
      clear();
      setConfirming(null);
      setErrors(failures);
    },
    onError: (cause: Error) => setErrors([cause.message]),
  });

  const startPending = async (mode: RunMode) => {
    const scope = pending;
    setPending(null);
    if (scope === null) return;
    const result = await start(scope, mode);
    setErrors(result.ok ? [] : [result.error]);
  };

  const perform: Record<
    FileActionKind,
    (targets: readonly IngestFile[]) => void
  > = {
    ingest: (targets) => setPending(targets.map((row) => row.rel_path)),
    done: (targets) => setConfirming({ kind: "done", targets }),
    delete: (targets) => setConfirming({ kind: "delete", targets }),
  };

  const busy = confirm.isPending;
  const actions = actionsFor(rows, selected, openQuestions).filter(
    (action) => enabled || !NEEDS_AGENT[action.kind],
  );

  // The queue read's failure joins the strip; only the mutations' are dismissable.
  const shownErrors = query.isError ? [query.error.message, ...errors] : errors;

  // Said where it cannot be scrolled away, not just in a chip per row.
  const asking = rows.filter((row) => openCountOf(openQuestions, row) > 0);
  const openCount = sumBy(asking, (row) => openCountOf(openQuestions, row));
  const firstAsk = asking[0]?.file_id ?? null;
  // An auto run answers its own questions; calling for the operator during one
  // would be false, and its Answer press would race the agent for the row.
  const agentAnswering = live && run.mode === "auto";

  const showSelectAll = rows.length > 0 && selected.size < rows.length;
  const showClear = selected.size > 0;
  const showActionBar = actions.length > 0 || showSelectAll || showClear;

  // The selection's locked files, which the ingest action drops before a run starts.
  const lockedBehind = rows
    .filter((row) => isLocked(row) && selected.has(row.rel_path))
    .map((row) => row.rel_path);

  const askStrip = () => {
    if (firstAsk === null) return null;
    if (agentAnswering) {
      return (
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <p className="text-muted-foreground min-w-0 flex-1 text-[11px]">
            {countNoun(openCount, "question")} open — the run is answering these
            itself.
          </p>
        </div>
      );
    }
    return (
      <div className="border-border bg-accent/10 flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <p className="text-accent min-w-0 flex-1 text-[11px]">
          {countNoun(openCount, "question")}{" "}
          {openCount === 1 ? "waits" : "wait"} for you — the files stay open
          until you answer.
        </p>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => view(firstAsk, "questions")}
        >
          Answer
        </Button>
      </div>
    );
  };

  const queueBody = () => {
    if (query.isPending) {
      return (
        <p className="px-3 py-2">
          <LoadingLine />
        </p>
      );
    }
    // The failure already leads the error strip above.
    if (query.isError) return null;
    if (rows.length === 0) {
      return (
        <p className="text-muted-foreground px-3 py-2 text-xs">
          Nothing in the queue. Drop a file above to start.
        </p>
      );
    }
    return (
      <ul className="divide-border divide-y">
        {rows.map((row) => (
          <FileRow
            key={row.path}
            row={row}
            openQuestions={openCountOf(openQuestions, row)}
          />
        ))}
      </ul>
    );
  };

  return (
    <Pane
      title="Files"
      /* The header keeps only the count: the 32px slot cannot hold a wrapping
         action bar, and a clipped button is a control that does not exist. */
      meta={
        selected.size > 0
          ? `${String(selected.size)} selected`
          : countsOf(query.data?.summary, rows.length)
      }
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
    >
      {!showActionBar ? null : (
        <div className="border-border flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5">
          {actions.map((action) => (
            <Button
              key={action.kind}
              size="sm"
              variant={action.kind === "delete" ? "outline" : "default"}
              disabled={live || busy || action.targets.length === 0}
              onClick={() => perform[action.kind](action.targets)}
            >
              {ACTION_LABEL[action.kind](action.targets.length)}
            </Button>
          ))}
          {!showSelectAll ? null : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => selectAll(rows.map((row) => row.rel_path))}
            >
              Select all
            </Button>
          )}
          {!showClear ? null : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
              Clear
            </Button>
          )}
          {/* Said where it renders: a disabled button swallows its tooltip. */}
          {live ? (
            <span className="text-muted-foreground text-[10px]">
              {actions.length > 0
                ? "A run is working the queue — these come back when it finishes."
                : "A run is working the queue."}
            </span>
          ) : null}
        </div>
      )}

      {confirming === null ? null : (
        <div className="border-border bg-secondary/40 flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <p className="min-w-0 flex-1 text-[11px]">
            {live
              ? "A run is working the queue — wait for it to finish."
              : CONFIRM[confirming.kind].ask(confirming.targets.length)}
          </p>
          <Button
            size="sm"
            className="shrink-0"
            /* The run lock holds here too: a confirm staged before a run must
               not execute into it. Cancel stays open — a way out never locks. */
            disabled={busy || live}
            onClick={() => confirm.mutate(confirming)}
          >
            {busy
              ? CONFIRM[confirming.kind].busy
              : CONFIRM[confirming.kind].verb}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            disabled={busy}
            onClick={() => setConfirming(null)}
          >
            Cancel
          </Button>
        </div>
      )}

      <div className="border-border shrink-0 border-b p-2">
        <Dropzone onUploaded={refresh} />
      </div>

      {/* Outside the scroll region: a failure a long queue can push out of
          sight was never reported. Three lines, then the count of the rest. */}
      {shownErrors.length === 0 ? null : (
        <div className="border-border flex shrink-0 items-start gap-2 border-b px-3 py-1.5">
          <div className="min-w-0 flex-1">
            {shownErrors.slice(0, SHOWN_ERROR_LINES).map((line, index) => (
              <p
                key={`${line}-${String(index)}`}
                className="text-destructive text-[10px]"
              >
                {line}
              </p>
            ))}
            {shownErrors.length <= SHOWN_ERROR_LINES ? null : (
              <p className="text-muted-foreground text-[10px]">
                …and {String(shownErrors.length - SHOWN_ERROR_LINES)} more
                failed.
              </p>
            )}
          </div>
          {/* The queue read's failure re-adds itself on the next poll; a
              dismiss that cannot dismiss it would be a button doing nothing. */}
          {errors.length === 0 ? null : (
            <RemoveButton
              label="Dismiss these failures"
              className="size-5 shrink-0"
              onClick={() => setErrors([])}
            />
          )}
        </div>
      )}

      {askStrip()}

      <div className="min-h-0 flex-1 overflow-y-auto">{queueBody()}</div>

      <ModeDialog
        open={pending !== null}
        files={pending?.length ?? 0}
        locked={lockedBehind}
        onPick={(mode) => void startPending(mode)}
        onClose={() => setPending(null)}
      />
    </Pane>
  );
}
