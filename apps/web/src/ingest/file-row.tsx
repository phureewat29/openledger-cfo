"use client";

import { memo, useState } from "react";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { isEqual } from "es-toolkit";
import { Lock } from "lucide-react";

import { cn } from "@openledger-cfo/ui";
import { Button } from "@openledger-cfo/ui/button";
import { Input } from "@openledger-cfo/ui/input";

import type { IngestFile } from "~/ingest/files";
import { isLocked, SETTLED, STATUS_LABEL } from "~/ingest/files";
import { runLine } from "~/ingest/run";
import { useQueueRefresh, useSelection } from "~/ingest/selection";
import { countNoun } from "~/lib/format";
import { Field } from "~/lib/ui/field";
import { Pulse } from "~/lib/ui/loading-line";
import { useTRPC } from "~/trpc/react";

const CHIP = "shrink-0 rounded-sm px-1.5 text-[10px] uppercase";

const STATUS_CHIP: Record<IngestFile["status"], string> = {
  new: "border-border border",
  pending: "text-foreground border-border border",
  ingested: "text-muted-foreground",
  failed: "text-destructive border-destructive/40 border",
  unreadable: "text-destructive border-destructive/40 border",
};

const FIELD = "h-7 text-xs";

function Row({
  row,
  openQuestions,
}: {
  row: IngestFile;
  openQuestions: number;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refreshQueue = useQueueRefresh();
  const { selected, toggle, viewerFileId, view } = useSelection();
  const fileId = row.file_id;

  // A prepare without its password still registers the file; only a missing extraction tells.
  const extraction = useQuery(
    trpc.ledger.ingest.document.queryOptions(
      row.encrypted && !SETTLED.has(row.status) && fileId !== null
        ? { fileId }
        : skipToken,
      { retry: false },
    ),
  );
  // Any other failed read is its own problem, not a password prompt.
  const missingExtraction = extraction.error?.data?.code === "NOT_FOUND";
  const locked = isLocked(row) || missingExtraction;
  const unreadable = extraction.isError && !missingExtraction;
  const [password, setPassword] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  // A prepare raises questions and writes the extraction the row reads to learn it is unlocked.
  const refresh = () => {
    refreshQueue();
    if (fileId !== null) {
      void queryClient.invalidateQueries(
        trpc.ledger.ingest.document.queryFilter({ fileId }),
      );
    }
  };

  const prepare = useMutation(
    trpc.ledger.ingest.prepare.mutationOptions({
      onSuccess: (result) => {
        refresh();
        if (!result.ok) return;
        setPassword("");
        view(result.file_id);
      },
    }),
  );

  const unlock = () =>
    prepare.mutate({
      // `prepare` takes either the registered id or a path on disk.
      pathOrId: fileId ?? row.path,
      password,
    });

  const picked = selected.has(row.rel_path);
  const viewing = fileId !== null && fileId === viewerFileId;
  const needsPassword =
    prepare.data?.ok === false ? prepare.data.message : null;
  const error = prepare.error?.message;

  return (
    <li
      className={cn(
        // The whole row lights for the file the info pane is reading; a
        // merely picked row keeps the fainter tint its checkbox explains.
        "px-3 py-1",
        viewing ? "bg-secondary" : picked && "bg-secondary/40",
      )}
    >
      <div className="flex min-h-7 items-center gap-2">
        <input
          type="checkbox"
          checked={picked}
          onChange={() => toggle(row.rel_path)}
          aria-label={`Select ${row.rel_path}`}
          className="accent-accent size-3 shrink-0 cursor-pointer"
        />
        {/* Only a registered file has anything to read; an unregistered name
            is just a name, and a button on it would have to mean something else. */}
        {fileId === null ? (
          <span className="min-w-0 flex-1 text-[11px] break-all">
            {row.rel_path}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => view(fileId)}
            title="Open in Info"
            className="hover:text-accent min-w-0 flex-1 cursor-pointer text-left text-[11px] break-all"
          >
            {row.rel_path}
          </button>
        )}
        {/* A word, not a 12px glyph: blocked-on-the-operator states should
            look alike, and the question chip set the shape. */}
        {row.encrypted && locked ? (
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            title="Enter its password to prepare it"
            className={cn(
              CHIP,
              "border-accent text-accent cursor-pointer border",
              panelOpen && "bg-accent/10",
            )}
          >
            Locked
          </button>
        ) : null}
        {row.encrypted && !locked ? (
          <Lock
            className="text-muted-foreground size-3 shrink-0"
            aria-label="Password protected"
          />
        ) : null}
        {prepare.isPending ? <Pulse label="Preparing" /> : null}
        {openQuestions === 0 || fileId === null ? null : (
          <button
            type="button"
            onClick={() => view(fileId, "questions")}
            // Filled: an open question is the row's loudest mark.
            className={cn(
              CHIP,
              "bg-accent text-accent-foreground cursor-pointer font-medium hover:brightness-[0.97]",
            )}
          >
            {countNoun(openQuestions, "question")}
          </button>
        )}
        <span className={cn(CHIP, STATUS_CHIP[row.status])}>
          {STATUS_LABEL[row.status]}
        </span>
      </div>

      {row.note === null ? null : (
        <div className="text-muted-foreground flex h-5 items-baseline gap-2 text-[10px]">
          <span className="truncate" title={row.note}>
            {row.note}
          </span>
        </div>
      )}

      {/* Closed by default: a queue of one bank's year is ten locked rows,
          and ten open forms would push the queue itself out of view. */}
      {locked && panelOpen ? (
        <div className="flex flex-col gap-1 pb-1">
          <p className="text-muted-foreground text-[10px]">
            {needsPassword ?? "Locked — enter its password to prepare it."}
          </p>
          <div className="flex items-end gap-1">
            <Field label="Password" className="flex-1">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={FIELD}
              />
            </Field>
            <Button
              size="sm"
              disabled={password.length === 0 || prepare.isPending}
              onClick={unlock}
            >
              Unlock
            </Button>
          </div>
        </div>
      ) : null}

      {unreadable ? (
        <p className="text-destructive text-[10px]">
          {runLine("Could not read this file", extraction.error.message)}
        </p>
      ) : null}

      {error === undefined ? null : (
        <p className="text-destructive text-[10px]">{error}</p>
      )}
    </li>
  );
}

// By value: every poll delivers fresh objects. Picking still re-renders through context.
export const FileRow = memo(
  Row,
  (previous, next) =>
    previous.openQuestions === next.openQuestions &&
    isEqual(previous.row, next.row),
);
