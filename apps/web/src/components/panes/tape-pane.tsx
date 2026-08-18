import Link from "next/link";

import {
  sanitizeLabel,
  sanitizeOptional,
} from "@openledger-cfo/agent/sanitize";
import { Pane } from "@openledger-cfo/ui/pane";

import type { TransactionRow } from "~/domain/postings";
import {
  accountLabel,
  formatDayMonth,
  formatThb,
  formatUsd,
} from "~/domain/format";
import { segmentOf } from "~/domain/postings";

/**
 * A row names two accounts and only one of them says what the money was for:
 * the expense or income side. Everything else falls back to the debit side,
 * which for a transfer is where the money landed.
 */
const rowCategoryOf = (row: TransactionRow) => {
  if (segmentOf(row.debit_account_id, 1) === "expense") {
    return accountLabel(row.debit_account_id, row.debit_account_name);
  }
  if (segmentOf(row.credit_account_id, 1) === "income") {
    return accountLabel(row.credit_account_id, row.credit_account_name);
  }
  return accountLabel(row.debit_account_id, row.debit_account_name);
};

const money = (row: TransactionRow) =>
  row.currency.toUpperCase() === "USD"
    ? formatUsd(row.amount)
    : formatThb(row.amount);

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
      scroll
      className={`@container/tape ${className ?? ""}`}
      bodyClassName="flex-1 overflow-y-auto p-0"
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground p-3 text-xs">
          No postings in the window.
        </p>
      ) : (
        // The whole row goes to the account, which is what its hover has been
        // promising; a link inside one cell left the rest of the row inert.
        <ul className="divide-border divide-y text-[11px] tabular-nums">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/accounts/${encodeURIComponent(row.debit_account_id)}`}
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
                  title={rowCategoryOf(row)}
                >
                  {rowCategoryOf(row)}
                </span>
                <span
                  className={`text-muted-foreground hidden w-[8rem] @xl/tape:block ${CELL}`}
                  title={sanitizeOptional(row.merchant_name) ?? undefined}
                >
                  {sanitizeOptional(row.merchant_name) ?? "—"}
                </span>
                <span className="w-[5.5rem] shrink-0 text-right whitespace-nowrap">
                  {money(row)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}
