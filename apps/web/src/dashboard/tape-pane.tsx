import Link from "next/link";

import {
  sanitizeLabel,
  sanitizeOptional,
} from "@openledger-cfo/agent/sanitize";
import { cn } from "@openledger-cfo/ui";
import { Pane } from "@openledger-cfo/ui/pane";

import type { TransactionRow } from "~/ledger/postings";
import { accountHref } from "~/ledger/accounts";
import { categoryLabelOf } from "~/ledger/postings";
import { formatDayMonth, moneyOf } from "~/lib/format";

const CELL = "shrink-0 truncate pr-3";

export function TapePane({
  rows,
  className,
}: {
  rows: readonly TransactionRow[];
  className?: string;
}) {
  return (
    <Pane
      title="Tape"
      meta={`Last ${rows.length}`}
      className={cn("@container/tape", className)}
      bodyClassName="flex-1 overflow-y-auto p-0"
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground p-3 text-xs">
          No postings in the window.
        </p>
      ) : (
        // The whole row links to the account, not just one cell.
        <ul className="divide-border divide-y text-[11px] tabular-nums">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={accountHref(row.debit_account_id)}
                title={sanitizeLabel(row.description)}
                className="hover:bg-secondary/60 flex h-7 items-center px-3"
              >
                <span className="text-muted-foreground w-[4.25rem] shrink-0 whitespace-nowrap">
                  {formatDayMonth(row.date)}
                </span>
                <span className="min-w-0 flex-1 truncate pr-3">
                  {sanitizeLabel(row.description)}
                </span>
                <span
                  className={`text-muted-foreground hidden w-[7rem] @md/tape:block ${CELL}`}
                  title={categoryLabelOf(row)}
                >
                  {categoryLabelOf(row)}
                </span>
                <span
                  className={`text-muted-foreground hidden w-[8rem] @xl/tape:block ${CELL}`}
                  title={sanitizeOptional(row.merchant_name) ?? undefined}
                >
                  {sanitizeOptional(row.merchant_name) ?? "—"}
                </span>
                <span className="w-[5.5rem] shrink-0 text-right whitespace-nowrap">
                  {moneyOf(row.currency)(row.amount)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}
