import { cn } from "@openledger-cfo/ui";

import {
  ACTION_COL,
  EVERYTHING_GRID,
  FLOW_COL,
  SEGMENT_STRIP,
  TAPE_COL,
  TRAJECTORY_COL,
} from "~/app/grid";
import { Breadcrumbs } from "~/components/breadcrumbs";
import { PaneFrame } from "~/components/pane-frame";
import { Shimmer, ShimmerBox } from "~/components/skeleton";

/**
 * Cell shells and column widths mirror monitor/vitals.tsx and the four pane
 * components; row counts mirror what the demo window always fills (six due
 * items, a handful of flags, fifteen tape rows). Edit those files and this
 * one together.
 */
const CELL =
  "border-border flex min-w-0 flex-col justify-center gap-0.5 border-l px-3 py-2 first:border-l-0";

const VITALS = [
  {
    label: "Net worth",
    figure: "text-[28px] leading-8 w-[7ch]",
    hint: "w-[14ch]",
    spark: true,
  },
  {
    label: "Month net",
    figure: "text-[20px] leading-6 w-[10ch]",
    hint: "w-[16ch]",
  },
  {
    label: "Savings rate",
    figure: "text-[20px] leading-6 w-[6ch]",
    hint: "w-[17ch]",
  },
  { label: "Cash", figure: "text-[20px] leading-6 w-[12ch]", hint: "w-[18ch]" },
  {
    label: "Projected spend",
    figure: "text-[20px] leading-6 w-[11ch]",
    hint: "w-[20ch]",
  },
  { label: "Owed", figure: "text-[20px] leading-6 w-[11ch]", hint: "w-[15ch]" },
];

const STRIP = [
  { label: "Banks", count: "w-[1ch]", amount: "w-[5ch]" },
  { label: "Cards", count: "w-[1ch]", amount: "w-[5ch]" },
  { label: "Loans", count: "w-[1ch]", amount: "w-[5ch]" },
  { label: "Invest", count: "w-[2ch]", amount: "w-[5ch]" },
];

/** Subscription rows carry a second filed-under line, at h-10 to the rest's h-7. */
const DUE = [
  { title: "w-[14ch]", filed: undefined },
  { title: "w-[18ch]", filed: undefined },
  { title: "w-[9ch]", filed: "w-[10ch]" },
  { title: "w-[16ch]", filed: undefined },
  { title: "w-[11ch]", filed: "w-[13ch]" },
  { title: "w-[10ch]", filed: "w-[9ch]" },
];

/** Severity hairlines in the mix the queue usually raises: warn, then info. */
const FLAGS = [
  { tone: "border-l-border", title: "w-[24ch]", tail: "w-[60%]" },
  { tone: "border-l-transparent", title: "w-[19ch]", tail: "w-[45%]" },
  { tone: "border-l-transparent", title: "w-[22ch]", tail: "w-[70%]" },
  { tone: "border-l-border", title: "w-[17ch]", tail: "w-[55%]" },
  { tone: "border-l-transparent", title: "w-[21ch]", tail: "w-[65%]" },
];

const TAPE_DESC = ["w-[24ch]", "w-[16ch]", "w-[20ch]", "w-[13ch]", "w-[27ch]"];

export default function EverythingLoading() {
  return (
    <div className="flex min-h-full flex-col @4xl/main:h-full">
      <Breadcrumbs crumbs={[{ label: "Everything" }]} />
      <h1 className="sr-only">Everything</h1>
      <div className={EVERYTHING_GRID}>
        <section className="border-border bg-card col-span-12 overflow-hidden rounded-lg border @4xl/main:h-[116px]">
          <div className="grid grid-cols-2 @2xl/main:grid-cols-3 @4xl/main:h-[88px] @4xl/main:grid-cols-6">
            {VITALS.map((cell) => (
              <figure key={cell.label} className={CELL}>
                <figcaption className="label">{cell.label}</figcaption>
                <Shimmer className={cell.figure} />
                <span className="flex">
                  <Shimmer className={cn("text-[10px]", cell.hint)} />
                </span>
                {cell.spark === true ? (
                  <ShimmerBox className="h-4 w-[90px] shrink-0" />
                ) : null}
              </figure>
            ))}
          </div>
          <div className={SEGMENT_STRIP}>
            {STRIP.map((segment) => (
              <span
                key={segment.label}
                className="flex shrink-0 items-baseline gap-1.5"
              >
                <span className="label">{segment.label}</span>
                <Shimmer className={segment.count} />
                <Shimmer className={segment.amount} />
              </span>
            ))}
          </div>
        </section>

        <PaneFrame
          title="Flow"
          className={FLOW_COL}
          bodyClassName="flex min-h-0 flex-1 flex-col p-1"
        >
          <ShimmerBox className="min-h-0 flex-1" />
        </PaneFrame>

        <PaneFrame
          title="Action"
          className={ACTION_COL}
          bodyClassName="flex min-h-0 flex-1 flex-col p-0"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="divide-border divide-y">
              {DUE.map((row, rank) => (
                <li
                  key={rank}
                  className={
                    row.filed === undefined
                      ? "flex h-7 items-center gap-2 px-3 text-[11px]"
                      : "block h-10 px-3 py-0.5 text-[11px]"
                  }
                >
                  <span
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2",
                      row.filed === undefined ? "h-7" : "h-5",
                    )}
                  >
                    <Shimmer className="w-11 shrink-0" />
                    <Shimmer className={row.title} />
                    <Shimmer className="ml-auto w-[8ch]" />
                    <ShimmerBox className="size-3 shrink-0 rounded-full" />
                  </span>
                  {row.filed === undefined ? null : (
                    <span className="flex h-4 pl-[3.25rem]">
                      <Shimmer className={cn("text-[10px]", row.filed)} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="flex px-3 py-1">
              <Shimmer className="w-[18ch] text-[10px]" />
            </p>

            <div className="border-border flex h-6 items-center border-t px-3">
              <span className="label">Flags</span>
            </div>

            <ul className="divide-border divide-y">
              {FLAGS.map((flag, rank) => (
                <li
                  key={rank}
                  className={cn("border-l-2 px-3 py-1.5", flag.tone)}
                >
                  <div className="flex items-center gap-2">
                    <Shimmer className={cn("text-xs", flag.title)} />
                    <Shimmer className="ml-auto w-[6ch] text-[11px]" />
                    {/* Stands where the dismiss button will: its box is in flow. */}
                    <span className="size-5 shrink-0" />
                  </div>
                  <div className="flex flex-col">
                    <Shimmer className="w-[95%] text-[10px]" />
                    <Shimmer className={cn("text-[10px]", flag.tail)} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="flex px-3 py-1">
              <Shimmer className="w-[13ch] text-[10px]" />
            </p>
          </div>
        </PaneFrame>

        <PaneFrame
          title="Trajectory"
          className={TRAJECTORY_COL}
          bodyClassName="flex min-h-0 flex-1 flex-col p-3"
        >
          <ShimmerBox className="min-h-0 flex-1" />
        </PaneFrame>

        <PaneFrame
          title="Tape"
          className={cn("@container/tape", TAPE_COL)}
          bodyClassName="flex-1 overflow-y-auto p-0"
        >
          <ul className="divide-border divide-y text-[11px] tabular-nums">
            {Array.from({ length: 15 }, (_, rank) => (
              <li key={rank} className="flex h-7 items-center px-3">
                <span className="flex w-[4.25rem] shrink-0">
                  <Shimmer className="w-[5ch]" />
                </span>
                <span className="flex min-w-0 flex-1 pr-3">
                  <Shimmer className={TAPE_DESC[rank % TAPE_DESC.length]} />
                </span>
                <span className="hidden w-[7rem] pr-3 @md/tape:flex">
                  <Shimmer className="w-[6ch]" />
                </span>
                <span className="hidden w-[8rem] pr-3 @xl/tape:flex">
                  <Shimmer className="w-[7ch]" />
                </span>
                <span className="flex w-[5.5rem] shrink-0 justify-end">
                  <Shimmer className="w-[7ch]" />
                </span>
              </li>
            ))}
          </ul>
        </PaneFrame>
      </div>
    </div>
  );
}
