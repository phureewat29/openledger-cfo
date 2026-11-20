import Link from "next/link";

import { cn } from "@openledger-cfo/ui";

import type { AccountMeta, AccountView } from "~/accounts/account";
import { HEAD_CELL, HEAD_GRID } from "~/accounts/grid";
import {
  formatDayMonth,
  formatPercent,
  formatPercentFine,
  formatQuantity,
  formatStamp,
  moneyOf,
  ordinalDay,
  priceOf,
} from "~/lib/format";

type Money = (amount: number) => string;

interface Cell {
  readonly label: string;
  readonly value: string;
}

const dayText = (day: number | null) => (day === null ? "—" : ordinalDay(day));

// The same stamp the postings below use, so one date reads one way on the page.
const dateText = (date: string | undefined) =>
  date === undefined ? "—" : formatStamp(date);

type MetaKind = AccountMeta["kind"];
type MetaOf<K extends MetaKind> = Extract<AccountMeta, { kind: K }>;

/** The balance is already the hero figure, so no cell here repeats it. */
const CELLS: {
  readonly [K in MetaKind]: (
    meta: MetaOf<K>,
    money: Money,
    price: Money,
  ) => readonly Cell[];
} = {
  card: (meta, money) => [
    meta.lastPayment === undefined
      ? { label: "Last payment", value: "—" }
      : {
          label: `Last payment · ${formatDayMonth(meta.lastPayment.date)}`,
          value: money(meta.lastPayment.amount),
        },
    { label: "Cycle since", value: formatStamp(meta.cycleFrom) },
    { label: "Statement", value: dayText(meta.statementDay) },
    { label: "Payment due", value: dayText(meta.dueDay) },
  ],
  loan: (meta, money) => [
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
  ],
  cash: (meta, money) => [
    { label: `Interest ${meta.year}`, value: money(meta.interestEarned) },
    { label: "Last activity", value: dateText(meta.lastActivity) },
    { label: "Paid in", value: money(meta.received) },
    { label: "Paid out", value: money(meta.sent) },
  ],
  position: (meta, money, price) => [
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
  ],
  basic: (meta, money) => [
    { label: "Total in", value: money(meta.totalIn) },
    { label: "Total out", value: money(meta.totalOut) },
    { label: "Transactions", value: String(meta.transactions) },
    { label: "Last activity", value: dateText(meta.lastActivity) },
  ],
};

// The generic key is what lets `CELLS[kind]` take a `MetaOf<K>`. It cannot
// pair them for a caller, where K is the whole union: pass the meta's own kind.
const cellsOf = <K extends MetaKind>(
  kind: K,
  meta: MetaOf<K>,
  money: Money,
  currency: string,
): readonly Cell[] => CELLS[kind](meta, money, priceOf(currency));

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
  const cells = cellsOf(
    account.meta.kind,
    account.meta,
    money,
    account.currency,
  );

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

      <div className={HEAD_GRID}>
        {cells.map((cell) => (
          <figure key={cell.label} className={HEAD_CELL}>
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
