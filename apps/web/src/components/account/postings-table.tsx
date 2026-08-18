"use client";

import { useState } from "react";
import { useQueries } from "@tanstack/react-query";

import { cn } from "@openledger-cfo/ui";
import { Button } from "@openledger-cfo/ui/button";

import type { TransactionRow } from "~/domain/postings";
import { LoadingLine } from "~/components/loading-line";
import {
  accountLabel,
  formatDayMonth,
  formatStamp,
  moneyOf,
} from "~/domain/format";
import { toPosting } from "~/domain/postings";
import { useTRPC } from "~/trpc/react";
import { PAGE_SIZE } from "./paging";

/**
 * A page of postings is a slice of what the ledger already recorded, so it does
 * not move while somebody reads it: coming back to the tab is not news.
 */
const PAGE_STALE_MS = 5 * 60 * 1000;

/** Past this the list is no longer a list, and every page is another read. */
const MAX_PAGES = 40;

/** The side of the row this account is not on — who it traded with. */
const counterpartyOf = (row: TransactionRow, debited: boolean) =>
  debited
    ? accountLabel(row.credit_account_id, row.credit_account_name)
    : accountLabel(row.debit_account_id, row.debit_account_name);

function Cell({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={cn("truncate pr-3", className)} title={title}>
      {children}
    </td>
  );
}

export function PostingsTable({
  account,
  currency,
}: {
  account: string;
  currency: string;
}) {
  const trpc = useTRPC();
  const [offsets, setOffsets] = useState([0]);

  const pages = useQueries({
    queries: offsets.map((offset) =>
      trpc.ledger.transactions.list.queryOptions(
        { account, limit: PAGE_SIZE, offset },
        { refetchOnWindowFocus: false, staleTime: PAGE_STALE_MS },
      ),
    ),
  });

  const money = moneyOf(currency);
  const rows = pages.flatMap((page) => page.data?.rows ?? []);
  const last = pages.at(-1);
  // One page failing says nothing about the pages already read, so those stay
  // on screen and the footer carries the failure instead.
  const failed = pages.find((page) => page.error !== null);
  const error = failed?.error ?? null;
  const busy = (failed ?? last)?.isFetching === true;
  // A position holds for years, so its list reaches back past the point where
  // a bare day and month stops saying which one.
  const spansYears = new Set(rows.map((row) => row.date.slice(0, 4))).size > 1;

  // The gap a failure leaves is that page, not the one after it, so a retry
  // re-reads the page that failed rather than asking for the next offset.
  const loadMore = () => {
    if (failed !== undefined) {
      void failed.refetch();
      return;
    }
    setOffsets((current) => [...current, current.length * PAGE_SIZE]);
  };

  if (rows.length === 0) {
    if (error !== null) {
      return <p className="text-destructive p-3 text-xs">{error.message}</p>;
    }
    if (last?.isPending === true) {
      return (
        <div className="p-3">
          <LoadingLine />
        </div>
      );
    }
    return (
      <p className="text-muted-foreground p-3 text-xs">No transactions.</p>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full table-fixed text-[11px] tabular-nums">
          <thead>
            <tr className="label bg-card sticky top-0 h-7 text-left">
              <th
                className={cn("pl-3 font-normal", spansYears ? "w-28" : "w-20")}
              >
                Date
              </th>
              <th className="font-normal">Description</th>
              <th className="w-1/4 font-normal">Counterparty</th>
              <th className="w-28 pr-3 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((row) => {
              const debited = row.debit_account_id === account;
              /**
               * Direction depends on the account's own kind, not merely which
               * side of the row it sits on: a debit pays down a liability but
               * funds an asset, so the sign follows `toPosting`'s authority —
               * which also sanitizes the description on the way through.
               */
              const posting = toPosting(
                row,
                account,
                debited ? row.debit_account_name : row.credit_account_name,
                debited ? "debit" : "credit",
              );
              const inflow = posting.signed >= 0;
              return (
                <tr key={row.id} className="hover:bg-secondary/60 h-7">
                  <Cell className="text-muted-foreground pl-3">
                    {spansYears
                      ? formatStamp(row.date)
                      : formatDayMonth(row.date)}
                  </Cell>
                  <Cell title={posting.label}>{posting.label}</Cell>
                  <Cell className="text-muted-foreground">
                    {counterpartyOf(row, debited)}
                  </Cell>
                  <Cell
                    className={cn(
                      "pr-3 text-right",
                      inflow ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {inflow ? "+" : "−"}
                    {money(row.amount)}
                  </Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {last?.data?.summary?.has_more === true || error !== null ? (
        <div className="border-border flex shrink-0 items-center gap-3 border-t p-2">
          {offsets.length >= MAX_PAGES && error === null ? (
            <p className="text-muted-foreground text-[11px]">
              {rows.length.toLocaleString("en-US")} postings shown — narrow the
              range to read further back.
            </p>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={loadMore}
            >
              {busy ? "Loading…" : "Load more"}
            </Button>
          )}
          {error === null ? null : (
            <p className="text-destructive text-xs">{error.message}</p>
          )}
        </div>
      ) : null}
    </>
  );
}
