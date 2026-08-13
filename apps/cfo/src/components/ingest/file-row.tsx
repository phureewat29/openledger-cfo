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

import { cn } from "@openledger-fleet/ui";
import { Button } from "@openledger-fleet/ui/button";
import { Input } from "@openledger-fleet/ui/input";

import type { IngestFile } from "~/domain/ingest-files";
import { useSelection } from "~/components/ingest/selection";
import { isLocked, SETTLED, STATUS_LABEL } from "~/domain/ingest-files";
import { useTRPC } from "~/trpc/react";

const CHIP = "shrink-0 rounded-sm px-1.5 text-[10px] uppercase";

const STATUS_CHIP: Record<IngestFile["status"], string> = {
  new: "border-border border",
  pending: "text-foreground border-border border",
  ingested: "text-muted-foreground",
  failed: "text-destructive border-destructive/40 border",
  unreadable: "text-destructive border-destructive/40 border",
};

const FIELD = "h-7 flex-1 text-xs";

function Row({
  row,
  openQuestions,
}: {
  row: IngestFile;
  openQuestions: number;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { selected, toggle, viewerFileId, view } = useSelection();
  const fileId = row.file_id;

  /**
   * A prepare that never got its password registers the file anyway: pending,
   * with an id and nothing extracted behind it. Only the extraction itself
   * tells that apart from a file that is genuinely ready, so a registered
   * encrypted file is asked for one — a read off disk, no command behind it.
   */
  const extraction = useQuery(
    trpc.ledger.ingest.document.queryOptions(
      row.encrypted && !SETTLED.has(row.status) && fileId !== null
        ? { fileId }
        : skipToken,
      { retry: false },
    ),
  );
  // A locked row keeps its password field open: the password is the only
  // thing that can move it, and unlocking is what closes the field.
  const locked = isLocked(row) || extraction.isError;
  const [password, setPassword] = useState("");

  // A prepare raises questions of its own, which at the queue's own pace would
  // sit unread for a poll or two after the command that asked them.
  const refresh = () => {
    void queryClient.invalidateQueries(trpc.ledger.ingest.list.queryFilter());
    void queryClient.invalidateQueries(
      trpc.ledger.questions.list.queryFilter(),
    );
    // Preparing writes the extraction, and the row reads it back to learn
    // whether it is still locked.
    if (fileId !== null) {
      void queryClient.invalidateQueries(
        trpc.ledger.ingest.document.queryFilter({ fileId }),
      );
    }
  };

  /** Unlocking is the one command a row still runs itself; the agent does the rest. */
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
          onChange={() => {
            toggle(row.rel_path);
            // Picking pulls the info pane along, so a multi-select reads out
            // whichever file was picked last.
            if (!picked && fileId !== null) view(fileId);
          }}
          aria-label={`Select ${row.rel_path}`}
          className="accent-accent size-3 shrink-0 cursor-pointer"
        />
        <button
          type="button"
          onClick={() =>
            fileId === null ? toggle(row.rel_path) : view(fileId)
          }
          className="min-w-0 flex-1 cursor-pointer text-left text-[11px] break-all"
        >
          {row.rel_path}
        </button>
        {row.encrypted ? (
          <Lock
            className="text-muted-foreground size-3 shrink-0"
            aria-label="Password protected"
          />
        ) : null}
        {prepare.isPending ? (
          <span
            aria-label="Preparing"
            className="bg-accent size-1.5 shrink-0 animate-pulse rounded-full"
          />
        ) : null}
        {openQuestions === 0 || fileId === null ? null : (
          <button
            type="button"
            onClick={() => view(fileId, "questions")}
            className={cn(
              CHIP,
              "border-accent text-accent hover:bg-secondary cursor-pointer border",
            )}
          >
            {openQuestions} to clarify
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

      {locked ? (
        <div className="flex flex-col gap-1 pb-1">
          <p className="text-muted-foreground text-[10px]">
            {needsPassword ?? "Locked — enter the password to prepare it."}
          </p>
          <div className="flex gap-1">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Document password"
              aria-label="Document password"
              className={FIELD}
            />
            <Button
              size="sm"
              className="h-7 px-2"
              disabled={password.length === 0 || prepare.isPending}
              onClick={unlock}
            >
              Unlock
            </Button>
          </div>
        </div>
      ) : null}

      {error === undefined ? null : (
        <p className="text-destructive text-[10px]">{error}</p>
      )}
    </li>
  );
}

/**
 * Compares by value, not identity: the queue arrives as fresh objects each
 * poll, and most change nothing worth losing. Picking still re-renders —
 * selection arrives through context, which memo cannot block.
 */
export const FileRow = memo(
  Row,
  (previous, next) =>
    previous.openQuestions === next.openQuestions &&
    isEqual(previous.row, next.row),
);
