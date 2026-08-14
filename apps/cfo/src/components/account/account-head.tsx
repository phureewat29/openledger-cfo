import Link from "next/link";

import { cn } from "@openledger-fleet/ui";

import type { AccountMeta, AccountView } from "~/server/account";
import {
  formatDayMonth,
  formatPercent,
  formatPercentFine,
  formatQuantity,
  formatStamp,
  moneyOf,
  ordinalDay,
  priceOf,
} from "~/domain/format";

type Money = (amount: number) => string;

interface Cell {
  readonly label: string;
  readonly value: string;
}

const dayText = (day: number | null) => (day === null ? "—" : ordinalDay(day));

// The same stamp the postings below use, so one date reads one way on the page.
const dateText = (date: string | undefined) =>
  date === undefined ? "—" : formatStamp(date);

/** The balance is already the hero figure, so no cell here repeats it. */
const cellsOf = (
  meta: AccountMeta,
  money: Money,
  currency: string,
): readonly Cell[] => {
  const price = priceOf(currency);

  switch (meta.kind) {
    case "card":
      return [
        meta.lastPayment === undefined
          ? { label: "Last payment", value: "—" }
          : {
              label: `Last payment · ${formatDayMonth(meta.lastPayment.date)}`,
              value: money(meta.lastPayment.amount),
            },
        { label: "Cycle since", value: formatStamp(meta.cycleFrom) },
        { label: "Statement", value: dayText(meta.statementDay) },
        { label: "Payment due", value: dayText(meta.dueDay) },
      ];
    case "loan":
      return [
        {
          label: "Implied rate",
          value:
            meta.impliedApr === undefined
              ? "—"
              : formatPercentFine(meta.impliedApr),
        },
        {
          label: `Repaid ${formatPercent(meta.progress)}`,
          value: money(meta.paid),
        },
        { label: "Borrowed", value: money(meta.original) },
        { label: "Interest paid", value: money(meta.interestPaid) },
      ];
    case "cash":
      return [
        { label: `Interest ${meta.year}`, value: money(meta.interestEarned) },
        { label: "Last activity", value: dateText(meta.lastActivity) },
        { label: "Paid in", value: money(meta.received) },
        { label: "Paid out", value: money(meta.sent) },
      ];
    case "position":
      return [
        {
          label: "Shares held",
          value: meta.shares === undefined ? "—" : formatQuantity(meta.shares),
        },
        {
          label: "Avg cost",
          value: meta.avgCost === undefined ? "—" : price(meta.avgCost),
        },
        meta.lastTrade === undefined
          ? { label: "Last buy", value: dateText(meta.lastBuy) }
          : {
              // The quantity rides in the label: two figures in one value is
              // the only composition wide enough to clip at the narrow tiers.
              label: `Last buy · ${formatDayMonth(meta.lastTrade.date)} · ${formatQuantity(meta.lastTrade.quantity)}`,
              value: price(meta.lastTrade.price),
            },
        { label: "Invested 12 mo", value: money(meta.invested12m) },
      ];
    case "basic":
      return [
        { label: "Total in", value: money(meta.totalIn) },
        { label: "Total out", value: money(meta.totalOut) },
        { label: "Transactions", value: String(meta.transactions) },
        { label: "Last activity", value: dateText(meta.lastActivity) },
      ];
  }
};

const typeChip = (account: AccountView) =>
  (account.subtype ?? account.type).replace(/[-_]/g, " ");

export function AccountHead({
  account,
  className,
}: {
  account: AccountView;
  className?: string;
}) {
  const money = moneyOf(account.currency);

  return (
    <section
      className={cn(
        "border-border bg-card overflow-hidden rounded-lg border",
        className,
      )}
    >
      {/* The name and its two tags share a baseline; the balance is its own
          column and centres in the band rather than hanging off theirs. */}
      <div className="flex h-10 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-base font-medium" title={account.name}>
            {account.name}
          </h1>
          <Link
            href="/accounts"
            className="border-border text-muted-foreground shrink-0 rounded-sm border px-1.5 text-[10px] uppercase"
          >
            {typeChip(account)}
          </Link>
          <span
            className="text-muted-foreground min-w-0 truncate text-[11px]"
            title={account.id}
          >
            {account.id}
          </span>
        </div>
        <span className="shrink-0 text-[20px] leading-6 font-medium tabular-nums">
          {money(account.balance)}
        </span>
      </div>

      <div className="border-border grid h-[52px] grid-cols-2 border-t @2xl/main:grid-cols-4">
        {cellsOf(account.meta, money, account.currency).map((cell) => (
          <figure
            key={cell.label}
            className="border-border flex min-w-0 flex-col justify-center gap-0.5 border-l px-3 py-1.5 first:border-l-0"
          >
            <figcaption className="label truncate" title={cell.label}>
              {cell.label}
            </figcaption>
            <div
              className="truncate text-[20px] leading-6 font-medium tabular-nums"
              title={cell.value}
            >
              {cell.value}
            </div>
          </figure>
        ))}
      </div>
    </section>
  );
}
