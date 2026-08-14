import { cn } from "@openledger-fleet/ui";

import {
  ACCOUNTS_GRID,
  GROUP_COL,
  GROUP_HALF,
  INVESTMENTS_COL,
  STRIP_ROW,
  TOTALS_CELL,
  TOTALS_ROW,
} from "~/app/accounts/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";
import { Shimmer, ShimmerBox } from "~/components/skeleton";

/**
 * Row shells, column widths and section order mirror group-panes.tsx and
 * composition-strip.tsx; row counts mirror the demo persona (ten cash rows,
 * four cards, two live loans, 11/6/3/2 positions), so the page streams in
 * over a frame that already stands exactly where the data will. Edit those
 * files and this one together.
 */
const STACKED = "flex flex-col gap-0.5 px-3 py-1.5";
const ROW = "flex h-7 items-center gap-2 px-3 text-[11px]";
const BODY = "flex min-h-0 flex-1 flex-col p-0";

const TOTALS = [
  { label: "Assets", figure: "w-[14ch]" },
  { label: "Liabilities", figure: "w-[13ch]" },
  { label: "Net", figure: "w-[14ch]" },
];

/** The strip is baht-only, so the four THB classes are all it ever folds to. */
const SEGMENTS = [
  { width: "w-[49%]", label: "w-[8ch]" },
  { width: "w-[31%]", label: "w-[5ch]" },
  { width: "w-[17%]", label: "w-[12ch]" },
  { width: "w-[3%]", label: undefined },
];

const BANKS = [
  { name: "w-[16ch]", figure: "w-[10ch]", moved: "w-[12ch]" },
  { name: "w-[12ch]", figure: "w-[9ch]", moved: "w-[13ch]" },
  { name: "w-[14ch]", figure: "w-[10ch]", moved: "w-[11ch]" },
  { name: "w-[18ch]", figure: "w-[8ch]", moved: "w-[12ch]" },
  { name: "w-[13ch]", figure: "w-[9ch]", moved: "w-[14ch]" },
  { name: "w-[20ch]", figure: "w-[9ch]", moved: "w-[11ch]" },
  { name: "w-[11ch]", figure: "w-[8ch]", moved: "w-[13ch]" },
  { name: "w-[15ch]", figure: "w-[7ch]", moved: "w-[12ch]" },
  { name: "w-[17ch]", figure: "w-[9ch]", moved: "w-[13ch]" },
  { name: "w-[12ch]", figure: "w-[8ch]", moved: "w-[12ch]" },
];

const CARDS = [
  { name: "w-[18ch]", figure: "w-[9ch]" },
  { name: "w-[13ch]", figure: "w-[9ch]" },
  { name: "w-[15ch]", figure: "w-[10ch]" },
  { name: "w-[20ch]", figure: "w-[9ch]" },
];

const LOANS = [
  { name: "w-[19ch]", figure: "w-[12ch]" },
  { name: "w-[21ch]", figure: "w-[10ch]" },
];

const HOLDINGS = [
  { label: "Stocks · USD", rows: 11 },
  { label: "Funds", rows: 6 },
  { label: "Crypto", rows: 3 },
  { label: "Property", rows: 2 },
];

/** Cycled per row so the columns read as absent names, not as one repeated bar. */
const POSITION_NAMES = ["w-[13ch]", "w-[17ch]", "w-[11ch]", "w-[15ch]"];

function BankRow({ widths }: { widths: (typeof BANKS)[number] }) {
  return (
    <li className={STACKED}>
      <span className="flex items-baseline gap-2 text-[11px]">
        <Shimmer className={widths.name} />
        <Shimmer className={cn("ml-auto", widths.figure)} />
      </span>
      <span className="flex items-center gap-2">
        <Shimmer className={cn("text-[10px]", widths.moved)} />
        <ShimmerBox className="ml-auto h-4 w-[60px] shrink-0" />
      </span>
    </li>
  );
}

function CardRow({ widths }: { widths: (typeof CARDS)[number] }) {
  return (
    <li className={STACKED}>
      <span className="flex items-baseline gap-2 text-[11px]">
        <Shimmer className={widths.name} />
        <Shimmer className={cn("ml-auto", widths.figure)} />
      </span>
      <Shimmer className="w-[15ch] text-[10px]" />
    </li>
  );
}

function LoanRow({ widths }: { widths: (typeof LOANS)[number] }) {
  return (
    <li className={STACKED}>
      <span className="flex items-baseline gap-2 text-[11px]">
        <Shimmer className={widths.name} />
        <Shimmer className={cn("ml-auto", widths.figure)} />
      </span>
      <span className="flex items-center gap-2">
        <ShimmerBox className="h-[3px] w-16 shrink-0" />
        <Shimmer className="w-[10ch] text-[10px]" />
      </span>
    </li>
  );
}

function PositionRow({ rank }: { rank: number }) {
  return (
    <li className={ROW}>
      <span className="flex w-16 shrink-0">
        <Shimmer className="w-[4ch]" />
      </span>
      <Shimmer className={POSITION_NAMES[rank % POSITION_NAMES.length]} />
      <span className="ml-auto flex w-24 shrink-0 justify-end">
        <Shimmer className="w-[7ch] text-[10px]" />
      </span>
      <span className="flex w-32 shrink-0 justify-end">
        <Shimmer className="w-[10ch]" />
      </span>
    </li>
  );
}

export default function AccountsLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Accounts" }]} />
      <h1 className="sr-only">Accounts</h1>
      <div className={ACCOUNTS_GRID}>
        <section className={TOTALS_ROW}>
          {TOTALS.map((cell) => (
            <figure key={cell.label} className={TOTALS_CELL}>
              <figcaption className="label">{cell.label}</figcaption>
              <Shimmer className={cn("text-[20px] leading-6", cell.figure)} />
            </figure>
          ))}
        </section>

        <section className={cn(STRIP_ROW, "flex flex-col gap-1")}>
          <div className="flex h-3 gap-[2px]">
            {SEGMENTS.map((segment) => (
              <ShimmerBox
                key={segment.width}
                className={cn("h-full", segment.width)}
              />
            ))}
          </div>
          <div className="flex gap-[2px]">
            {SEGMENTS.map((segment) => (
              <span
                key={segment.width}
                className={cn("flex min-w-0", segment.width)}
              >
                {segment.label === undefined ? null : (
                  <Shimmer className={cn("text-[10px]", segment.label)} />
                )}
              </span>
            ))}
          </div>
        </section>

        <PaneFrame
          title="Banks & cash"
          className={GROUP_HALF}
          bodyClassName={BODY}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="divide-border divide-y">
              {BANKS.map((widths, rank) => (
                <BankRow key={rank} widths={widths} />
              ))}
            </ul>
          </div>
        </PaneFrame>

        <PaneFrame title="Cards" className={GROUP_HALF} bodyClassName={BODY}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="divide-border divide-y">
              {CARDS.map((widths, rank) => (
                <CardRow key={rank} widths={widths} />
              ))}
            </ul>
          </div>
        </PaneFrame>

        <PaneFrame title="Loans" className={GROUP_COL} bodyClassName={BODY}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="divide-border divide-y">
              {LOANS.map((widths, rank) => (
                <LoanRow key={rank} widths={widths} />
              ))}
            </ul>
          </div>
          <p className="border-border flex shrink-0 border-t px-3 py-1">
            <Shimmer className="w-[8ch] text-[10px]" />
          </p>
        </PaneFrame>

        <PaneFrame
          title="Investments"
          className={INVESTMENTS_COL}
          bodyClassName={BODY}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {HOLDINGS.map((holding) => (
              <div key={holding.label}>
                <div className="border-border flex h-6 items-center justify-between gap-2 border-t px-3 first:border-t-0">
                  <span className="label">{holding.label}</span>
                  <Shimmer className="w-[9ch] text-[10px]" />
                </div>
                <ul className="divide-border divide-y border-t">
                  {Array.from({ length: holding.rows }, (_, rank) => (
                    <PositionRow key={rank} rank={rank} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </PaneFrame>
      </div>
    </div>
  );
}
