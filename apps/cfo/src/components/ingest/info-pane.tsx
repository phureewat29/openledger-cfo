"use client";

import { useMemo, useState } from "react";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { Button } from "@openledger-fleet/ui/button";
import { Input } from "@openledger-fleet/ui/input";
import { Pane } from "@openledger-fleet/ui/pane";

import type { FileImpact } from "~/domain/ingest-files";
import type { IngestQuestion } from "~/server/ingest";
import { useSelection } from "~/components/ingest/selection";
import { LoadingLine } from "~/components/loading-line";
import { countNoun, moneyOf } from "~/domain/format";
import { fileImpactOf, SETTLED } from "~/domain/ingest-files";
import { runLine } from "~/domain/ingest-run";
import { useTRPC } from "~/trpc/react";

/** `prepare` writes one of these between pages, whichever reader produced the text. */
const PAGE_BREAK = /^(--- page \d+ ---)$/gm;

const WORKING_MS = 3000;
const CONTEXT_CHARS = 240;
const MAX_SUMMARY_ROWS = 60;

/** The ledger fact, not a guess at direction: what the file put on each side. */
const netOf = (impact: FileImpact): string => {
  const net = impact.debits - impact.credits;
  const format = moneyOf(impact.currency);
  return net >= 0 ? `debited ${format(net)}` : `credited ${format(-net)}`;
};

const contextOf = (context: unknown): string | null => {
  if (context === null || context === undefined) return null;
  const json = JSON.stringify(context);
  return json.slice(0, CONTEXT_CHARS);
};

function QuestionRow({ row }: { row: IngestQuestion }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [response, setResponse] = useState("");

  const settled = {
    onSuccess: () =>
      void queryClient.invalidateQueries(
        trpc.ledger.questions.list.queryFilter(),
      ),
  };
  const answer = useMutation(
    trpc.ledger.questions.answer.mutationOptions(settled),
  );
  const defer = useMutation(
    trpc.ledger.questions.defer.mutationOptions(settled),
  );

  const busy = answer.isPending || defer.isPending;
  const error = answer.error?.message ?? defer.error?.message;
  const context = contextOf(row.context);

  return (
    <li className="flex flex-col gap-1 px-3 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="border-border shrink-0 rounded-sm border px-1.5 text-[10px] uppercase">
          {row.kind ?? "question"}
        </span>
        <span className="min-w-0 flex-1 text-xs">{row.prompt}</span>
      </div>

      {context === null ? null : (
        <p
          className="text-muted-foreground truncate text-[10px]"
          title={context}
        >
          {context}
        </p>
      )}

      <div className="flex gap-1">
        <Input
          value={response}
          onChange={(event) => setResponse(event.target.value)}
          placeholder="Answer"
          aria-label="Answer"
          className="h-7 min-w-0 flex-1"
        />
        <Button
          size="sm"
          className="h-7 px-2"
          disabled={response.trim().length === 0 || busy}
          onClick={() =>
            answer.mutate({ id: row.id, response: response.trim() })
          }
        >
          Answer
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={busy}
          onClick={() => defer.mutate({ id: row.id })}
        >
          Defer
        </Button>
      </div>

      {error === undefined ? null : (
        <p className="text-destructive text-[10px]">{error}</p>
      )}
    </li>
  );
}

/**
 * One pane over the file the operator is looking at: its extracted text, or
 * the questions the ledger raised from it. Which one is the selection's to
 * decide — View opens the document, a row's question chip opens the queue.
 */
export function InfoPane({ className }: { className?: string }) {
  const trpc = useTRPC();
  const { viewerFileId, viewerMode } = useSelection();
  const [includeDeferred, setIncludeDeferred] = useState(false);

  // The name is the file list's read, already in cache; this rides it.
  const files = useQuery(trpc.ledger.ingest.list.queryOptions(undefined));
  const viewed = files.data?.rows.find((row) => row.file_id === viewerFileId);
  // A closed file has no extraction left; its story is the rows it posted.
  const settled = viewed !== undefined && SETTLED.has(viewed.status);

  const document = useQuery(
    trpc.ledger.ingest.document.queryOptions(
      viewerFileId === null || viewerMode !== "document" || settled
        ? skipToken
        : { fileId: viewerFileId },
    ),
  );
  const posted = useQuery(
    trpc.ledger.transactions.listByFile.queryOptions(
      viewerFileId === null || viewerMode !== "document" || !settled
        ? skipToken
        : { fileId: viewerFileId },
    ),
  );
  /**
   * Off, this is the key the file list already polls and the pane rides its
   * cache entry; on, it is a second key with nobody else watching it, so this
   * is the one that carries an interval.
   */
  const questions = useQuery(
    trpc.ledger.questions.list.queryOptions(
      includeDeferred ? { includeDeferred: true } : {},
      { refetchInterval: includeDeferred ? WORKING_MS : false },
    ),
  );

  const extraction = document.data;
  // Splitting on a capturing group keeps the breaks: odd slots are the markers.
  const parts = useMemo(
    () => (extraction === undefined ? [] : extraction.text.split(PAGE_BREAK)),
    [extraction],
  );

  const raised =
    viewerFileId === null
      ? []
      : (questions.data?.rows ?? []).filter(
          (row) => row.file_id === viewerFileId,
        );

  const name =
    viewed?.rel_path ??
    (viewerFileId === null ? undefined : `…${viewerFileId.slice(-6)}`);

  const documentBody = () => {
    if (document.isError) {
      return (
        <p className="text-destructive text-xs">{document.error.message}</p>
      );
    }
    if (extraction === undefined) {
      return <LoadingLine />;
    }
    if (extraction.text.length === 0) {
      return (
        <p className="text-muted-foreground text-xs">
          The extraction is empty. Prepare the file again, or discard it with a
          note.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        {extraction.truncated ? (
          <p className="border-border text-muted-foreground border-l-2 pl-2 text-xs">
            Long document — only its first part was read.
          </p>
        ) : null}
        <pre className="text-[11px] whitespace-pre-wrap">
          {parts.map((part, index) =>
            index % 2 === 1 ? (
              <span
                key={index}
                className="text-accent border-accent/40 my-2 block border-t pt-2 text-[10px] tracking-[0.15em] uppercase"
              >
                {part.replaceAll("-", "").trim()}
              </span>
            ) : (
              <span key={index}>{part}</span>
            ),
          )}
        </pre>
      </div>
    );
  };

  /** A closed file's story: which accounts its rows hit and by how much. */
  const summaryBody = () => {
    if (posted.isError) {
      return <p className="text-destructive text-xs">{posted.error.message}</p>;
    }
    if (posted.data === undefined) {
      return <LoadingLine />;
    }
    if (posted.data.length === 0) {
      return (
        <p className="text-muted-foreground text-xs">
          No transactions carry this file.
        </p>
      );
    }

    const impacts = fileImpactOf(posted.data);
    return (
      <div className="flex flex-col gap-2">
        {viewerFileId === null ? null : (
          <p className="text-muted-foreground text-[10px]">{viewerFileId}</p>
        )}
        <ul className="flex flex-col gap-1">
          {impacts.map((impact) => (
            <li
              key={impact.account}
              className="flex items-baseline gap-2 text-[11px]"
            >
              <span className="min-w-0 flex-1 truncate" title={impact.account}>
                {impact.name ?? impact.account}
              </span>
              <span className="shrink-0 tabular-nums">{netOf(impact)}</span>
            </li>
          ))}
        </ul>
        <div className="border-border flex flex-col gap-1 border-t pt-2">
          {posted.data.slice(0, MAX_SUMMARY_ROWS).map((row) => (
            <div key={row.id} className="flex items-baseline gap-2 text-[10px]">
              <span className="text-muted-foreground shrink-0">{row.date}</span>
              <span
                className="min-w-0 flex-1 truncate"
                title={`${row.debit_account_id} ← ${row.credit_account_id}`}
              >
                {row.description}
              </span>
              <span className="shrink-0 tabular-nums">
                {moneyOf(row.currency)(row.amount)}
              </span>
            </div>
          ))}
          {posted.data.length > MAX_SUMMARY_ROWS ? (
            <p className="text-muted-foreground text-[10px]">
              …and {String(posted.data.length - MAX_SUMMARY_ROWS)} more rows
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  const questionsBody = () => {
    if (questions.isError) {
      return (
        <p className="text-destructive text-xs">{questions.error.message}</p>
      );
    }
    if (raised.length === 0) {
      return (
        <p className="text-muted-foreground text-xs">
          Nothing to answer for this file.
        </p>
      );
    }
    return (
      <ul className="divide-border -mx-3 divide-y">
        {raised.map((row) => (
          <QuestionRow key={row.id} row={row} />
        ))}
      </ul>
    );
  };

  const body = () => {
    if (viewerFileId === null) {
      return (
        <p className="text-muted-foreground text-xs">
          Pick a file to read it here — extracted text while it is open, what it
          posted once it closed. A row&apos;s question chip opens what the
          ledger asked about it.
        </p>
      );
    }
    if (viewerMode === "questions") return questionsBody();
    return settled ? summaryBody() : documentBody();
  };

  const detail = () => {
    if (viewerMode === "questions") {
      return countNoun(raised.length, "question");
    }
    if (settled) {
      if (posted.data === undefined) return undefined;
      return `${countNoun(posted.data.length, "row")} posted`;
    }
    if (extraction === undefined) return undefined;
    return countNoun(extraction.page_count, "page");
  };

  return (
    <Pane
      title="Info"
      meta={viewerFileId === null ? undefined : runLine(name, detail())}
      actions={
        viewerMode !== "questions" ? undefined : (
          <label className="label flex cursor-pointer items-center gap-1 select-none">
            <input
              type="checkbox"
              checked={includeDeferred}
              onChange={(event) => setIncludeDeferred(event.target.checked)}
              className="accent-accent size-3"
            />
            Deferred
          </label>
        )
      }
      scroll
      className={className}
    >
      {body()}
    </Pane>
  );
}
