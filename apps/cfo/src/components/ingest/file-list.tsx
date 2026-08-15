"use client";

import { useState } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { Button } from "@openledger-fleet/ui/button";
import { Pane } from "@openledger-fleet/ui/pane";

import type {
  FileActionKind,
  IngestCounts,
  IngestFile,
} from "~/domain/ingest-files";
import type { RunMode } from "~/domain/ingest-run";
import { startIngestRun, useIngestRun } from "~/components/ingest-run-provider";
import { Dropzone } from "~/components/ingest/dropzone";
import { FileRow } from "~/components/ingest/file-row";
import { ModeDialog } from "~/components/ingest/mode-dialog";
import { useSelection } from "~/components/ingest/selection";
import { LoadingLine } from "~/components/loading-line";
import { RemoveButton } from "~/components/plan/remove-button";
import { useHydrated } from "~/components/use-hydrated";
import { countNoun } from "~/domain/format";
import {
  actionsFor,
  isLocked,
  openCountOf,
  openQuestionsByFile,
} from "~/domain/ingest-files";
import { isRunLive, runLine } from "~/domain/ingest-run";
import { useTRPC, useTRPCClient } from "~/trpc/react";

/**
 * The directory only changes under a command, so the fast pace is for a queue
 * somebody is working through; a settled pipeline is watched, not polled.
 */
const WORKING_MS = 3000;
const IDLE_MS = 15000;

const paceOf = (summary: IngestCounts | null | undefined, working: boolean) =>
  working || (summary?.new ?? 0) + (summary?.pending ?? 0) > 0
    ? WORKING_MS
    : IDLE_MS;

const ACTION_LABEL: Record<FileActionKind, (count: number) => string> = {
  // Two labels on purpose: the whole queue and a selection are different asks,
  // and the number alone was the only thing telling them apart.
  "ingest-all": (count) => `Ingest all (${String(count)})`,
  ingest: (count) => `Ingest (${String(count)})`,
  done: (count) => `Close (${String(count)})`,
  delete: (count) => `Delete (${String(count)})`,
};

/** Both write the ledger or the disk; neither moves without a second look. */
type ConfirmKind = "close" | "delete";

interface Confirming {
  readonly kind: ConfirmKind;
  readonly targets: readonly IngestFile[];
}

const CONFIRM_ASK: Record<ConfirmKind, (count: number) => string> = {
  close: (count) =>
    `Close ${countNoun(count, "file")}? Each is recorded in the ledger as ingested.`,
  delete: (count) =>
    `Delete ${countNoun(count, "file")}? Rows and questions the ledger recorded for them go too.`,
};

const CONFIRM_VERB: Record<ConfirmKind, string> = {
  close: "Close",
  delete: "Delete",
};

/** Without a key the agent cannot run; closing and removing by hand still can. */
const NEEDS_AGENT: Record<FileActionKind, boolean> = {
  "ingest-all": true,
  ingest: true,
  done: false,
  delete: false,
};

const countPart = (value: number, label: string) =>
  value > 0 ? `${String(value)} ${label}` : undefined;

/** Error lines shown in full before the strip folds into a count. */
const SHOWN_ERROR_LINES = 3;

/**
 * What is still work, which is what this pane is for. Closed files are left
 * out on purpose: their count only grows, and it would crowd the header off
 * the states somebody can still act on.
 */
const countsOf = (summary: IngestCounts | null | undefined, rows: number) => {
  if (summary === null || summary === undefined) {
    return countNoun(rows, "file");
  }
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
type PendingRun =
  | { readonly all: true; readonly count: number }
  | { readonly pathOrIds: readonly string[] };

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
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const { run } = useIngestRun();
  const { selected, selectAll, clear } = useSelection();
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
  const live = hydrated && run !== null && isRunLive(run.status);

  const refresh = () => {
    void queryClient.invalidateQueries(trpc.ledger.ingest.list.queryFilter());
    void queryClient.invalidateQueries(
      trpc.ledger.questions.list.queryFilter(),
    );
  };

  const closeFiles = useMutation({
    mutationFn: async (targets: readonly IngestFile[]) => {
      const failures: string[] = [];
      for (const row of targets) {
        if (row.file_id === null) continue;
        const closed = await client.ledger.ingest.done.mutate({
          fileId: row.file_id,
        });
        if (!closed.ok) failures.push(runLine(row.rel_path, closed.message));
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

  const removeFiles = useMutation({
    mutationFn: async (targets: readonly IngestFile[]) => {
      const failures: string[] = [];
      for (const row of targets) {
        const failure = await removeFile(row);
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

  const start = async (mode: RunMode) => {
    const scope = pending;
    setPending(null);
    if (scope === null) return;
    const result = await startIngestRun(
      "pathOrIds" in scope ? scope : { all: true },
      mode,
    );
    setErrors(result.ok ? [] : [result.message]);
  };

  const perform: Record<
    FileActionKind,
    (targets: readonly IngestFile[]) => void
  > = {
    "ingest-all": (targets) => setPending({ all: true, count: targets.length }),
    ingest: (targets) =>
      setPending({ pathOrIds: targets.map((row) => row.rel_path) }),
    done: (targets) => setConfirming({ kind: "close", targets }),
    delete: (targets) => setConfirming({ kind: "delete", targets }),
  };

  const busy = closeFiles.isPending || removeFiles.isPending;
  const actions = actionsFor(rows, selected, openQuestions).filter(
    (action) => enabled || !NEEDS_AGENT[action.kind],
  );

  // The queue read's failure joins the strip; only the mutations' are dismissable.
  const shownErrors = query.isError
    ? [query.error.message, ...errors]
    : errors;

  // What a run leaves behind, said before it starts rather than found afterwards:
  // the whole queue's locked files, or for a named run the operator's own locked
  // picks, which the ingest action drops before they ever reach a run.
  const picked =
    pending !== null && "pathOrIds" in pending ? pending.pathOrIds : null;
  const lockedBehind = rows
    .filter(
      (row) => isLocked(row) && (picked === null || selected.has(row.rel_path)),
    )
    .map((row) => row.rel_path);

  return (
    <Pane
      title="Files"
      /* The header is the one action bar: the count while picking, the queue
         totals otherwise, and every button the current selection can use. */
      meta={
        selected.size > 0
          ? `${String(selected.size)} selected`
          : countsOf(query.data?.summary, rows.length)
      }
      actions={
        <span className="flex items-center gap-1">
          {actions.map((action) => (
            <Button
              key={action.kind}
              size="sm"
              disabled={live || busy || action.targets.length === 0}
              /* A greyed button with no reason reads as broken. */
              title={live ? "A run is working the queue" : undefined}
              onClick={() => perform[action.kind](action.targets)}
            >
              {ACTION_LABEL[action.kind](action.targets.length)}
            </Button>
          ))}
          {rows.length === 0 || selected.size >= rows.length ? null : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => selectAll(rows.map((row) => row.rel_path))}
            >
              Select all
            </Button>
          )}
          {selected.size === 0 ? null : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
              Clear
            </Button>
          )}
        </span>
      }
      className={className}
      bodyClassName="flex min-h-0 flex-1 flex-col p-0"
    >
      {confirming === null ? null : (
        <div className="border-border bg-secondary/40 flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <p className="min-w-0 flex-1 text-[11px]">
            {CONFIRM_ASK[confirming.kind](confirming.targets.length)}
          </p>
          <Button
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() =>
              (confirming.kind === "close" ? closeFiles : removeFiles).mutate(
                confirming.targets,
              )
            }
          >
            {CONFIRM_VERB[confirming.kind]}
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
              <p key={`${line}-${String(index)}`} className="text-destructive text-[10px]">
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
          <RemoveButton
            label="Dismiss errors"
            className="size-5 shrink-0"
            disabled={false}
            onClick={() => setErrors([])}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <p className="px-3 py-2">
            <LoadingLine />
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-xs">
            Nothing in the data directory.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => (
              <FileRow
                key={row.path}
                row={row}
                openQuestions={openCountOf(openQuestions, row)}
              />
            ))}
          </ul>
        )}
      </div>

      <ModeDialog
        open={pending !== null}
        all={picked === null}
        files={
          pending === null
            ? 0
            : "all" in pending
              ? pending.count
              : pending.pathOrIds.length
        }
        locked={lockedBehind}
        onPick={(mode) => void start(mode)}
        onClose={() => setPending(null)}
      />
    </Pane>
  );
}
