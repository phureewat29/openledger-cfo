"use client";

import { useMemo, useRef, useState } from "react";
import { extent } from "d3-array";
import { scaleLinear, scalePoint } from "d3-scale";
import {
  curveLinear,
  curveStepAfter,
  area as toArea,
  line as toLine,
} from "d3-shape";
import { clamp, compact, range } from "es-toolkit";

import { cn } from "@openledger-cfo/ui";

import type { Point } from "~/lib/charts/data";
import type { ChartSize } from "~/lib/charts/frame";
import { hasMovement, paddedDomain } from "~/lib/charts/data";
import { ChartFrame } from "~/lib/charts/frame";
import { compactOf } from "~/lib/format";

/**
 * The band the data plots into. A dot on an extreme carries a 2px ring, and a
 * clipped ring reads as a square, so the extremes sit a dot's radius inside.
 */
const INSET = 6;
const AXIS = "text-muted-foreground text-[10px] tabular-nums";
const TICKS = 3;
const EXPANDED_TICKS = 5;
/** Past this the dates on the axis start running into each other. */
const EXPANDED_LABELS = 12;

const NO_MARKS: readonly number[] = [];
const NO_PROJECTION: readonly Point[] = [];

// One authority for where sample `i` sits: the plot asks in pixels, the axis in percent.
const pointScale = (count: number, width: number) =>
  scalePoint<number>().domain(range(count)).range([0, width]);

/**
 * Measured over the projection too: a dashed tail heading somewhere the scale
 * does not reach would leave the plot rather than say where it lands.
 */
const extremesOf = (points: readonly Point[], tail: readonly Point[]) => {
  const [low, high] = extent([...points, ...tail], (point) => point.y);
  return { bottom: low ?? 0, top: high ?? 0 };
};

const shareOf = (tick: number, ticks: number) => tick / (ticks - 1);

const labelIndices = (count: number, expanded: boolean): number[] => {
  if (count <= 2) return range(count);
  if (!expanded) return [0, Math.floor((count - 1) / 2), count - 1];
  const step = Math.max(1, Math.ceil(count / EXPANDED_LABELS));
  const walked = range(0, count, step);
  return walked.at(-1) === count - 1 ? walked : [...walked, count - 1];
};

/** First and last labels turn inward so neither hangs off the plot. */
const anchorOf = (at: number, total: number) => {
  if (at === 0) return undefined;
  if (at === total - 1) return "translateX(-100%)";
  return "translateX(-50%)";
};

/** Arrow keys walk the same samples the pointer snaps to. */
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

// Snaps to the nearest sample; the box is read once per pointer visit, never per move.
const useSnapIndex = (count: number) => {
  const [index, setIndex] = useState<number | null>(null);
  const box = useRef<DOMRect | null>(null);
  const clientX = useRef(0);
  const frame = useRef(0);

  const snap = () => {
    frame.current = 0;
    const rect = box.current;
    if (rect === null || rect.width === 0) return;
    const share = (clientX.current - rect.left) / rect.width;
    setIndex(clamp(Math.round(share * (count - 1)), 0, count - 1));
  };

  const cancel = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };

  const handlers = {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      box.current = event.currentTarget.getBoundingClientRect();
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      // Not `??=`: the React Compiler skips any hook that uses it.
      const rect = box.current ?? event.currentTarget.getBoundingClientRect();
      box.current = rect;
      clientX.current = event.clientX;
      if (frame.current === 0) frame.current = requestAnimationFrame(snap);
    },
    onPointerLeave: () => {
      cancel();
      box.current = null;
      setIndex(null);
    },
    onFocus: () => setIndex(count - 1),
    onBlur: () => {
      cancel();
      setIndex(null);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      // Escape only belongs to the chart while it has something to clear;
      // otherwise it is the enclosing dialog's to act on.
      if (event.key === "Escape") {
        if (index === null) return;
        event.preventDefault();
        setIndex(null);
        return;
      }
      const step = STEP[event.key];
      if (step === undefined) return;
      event.preventDefault();
      setIndex((current) => clamp((current ?? count - 1) + step, 0, count - 1));
    },
  };

  return { index, handlers };
};

type SnapHandlers = ReturnType<typeof useSnapIndex>["handlers"];

// HTML over the plot, not SVG marks: a stretched viewBox would flatten the dot.
function CrosshairLayer({
  x,
  y,
  accent = false,
  rule = true,
}: {
  x: number;
  y: number;
  accent?: boolean;
  /** The dot marks where the series ends even at rest; the rule is the cursor. */
  rule?: boolean;
}) {
  return (
    <>
      {rule ? (
        <span
          aria-hidden
          className="bg-border absolute inset-y-0 w-px"
          style={{ left: x }}
        />
      ) : null}
      <span
        aria-hidden
        className={cn(
          "ring-card absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2",
          accent ? "bg-accent" : "bg-foreground",
        )}
        style={{ left: x, top: y }}
      />
    </>
  );
}

interface ReadoutRow {
  readonly key: string;
  readonly value: string;
}

// Every figure the cursor reaches also lands here, clear of the plot.
function ChartReadout({
  x,
  rows,
}: {
  x: string | undefined;
  rows: readonly ReadoutRow[];
}) {
  return (
    <div className="flex h-4 shrink-0 items-baseline justify-end gap-2 text-[11px] tabular-nums">
      {x === undefined ? null : (
        <span className="text-muted-foreground mr-auto text-[10px]">{x}</span>
      )}
      {rows.map((row) => (
        <span key={row.key} className="flex items-baseline gap-1">
          {row.value}
        </span>
      ))}
    </div>
  );
}

interface Plotted {
  readonly points: readonly Point[];
  readonly projection: readonly Point[];
  readonly step: boolean;
  readonly area: boolean;
  readonly accent: boolean;
  readonly marks: readonly number[];
  readonly ticks: number;
  readonly low: number;
  readonly high: number;
  readonly crossesZero: boolean;
}

function Plot({
  size,
  plotted,
  index,
  handlers,
}: {
  size: ChartSize;
  plotted: Plotted;
  index: number | null;
  handlers: SnapHandlers;
}) {
  const { w, h } = size;
  const {
    points,
    projection,
    step,
    area,
    accent,
    marks,
    ticks,
    low,
    high,
    crossesZero,
  } = plotted;

  // Keyed on the data and the box alone, so a pointer move, a focus or a poll
  // can never reach the layout.
  const geometry = useMemo(() => {
    // No `.nice()`: the axis prints this exact domain, so rounding has nothing to line up with.
    const yOf = scaleLinear()
      .domain([low, high])
      .range([h - INSET, INSET]);
    const x = pointScale(points.length + projection.length, w);
    const xOf = (at: number) => x(at) ?? 0;
    const curve = step ? curveStepAfter : curveLinear;
    const base = crossesZero ? yOf(0) : h - INSET;

    const linePath = toLine<Point>()
      .x((_, at) => xOf(at))
      .y((point) => yOf(point.y))
      .curve(curve);
    const areaPath = toArea<Point>()
      .x((_, at) => xOf(at))
      .y0(base)
      .y1((point) => yOf(point.y))
      .curve(curve);
    const last = points.at(-1);
    const tailPath = toLine<Point>()
      .x((_, at) => xOf(points.length - 1 + at))
      .y((point) => yOf(point.y));

    return {
      xOf,
      yOf,
      base,
      line: linePath(points) ?? "",
      area: areaPath(points) ?? "",
      tail: last === undefined ? "" : (tailPath([last, ...projection]) ?? ""),
    };
  }, [points, projection, step, w, h, low, high, crossesZero]);

  const marked = index ?? points.length - 1;
  const point = points[marked];
  const stroke = accent ? "var(--color-accent)" : "var(--color-foreground)";
  const end = projection.at(-1);

  return (
    <>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="absolute inset-0"
        aria-hidden
      >
        {range(ticks).map((tick) => {
          const y = INSET + shareOf(tick, ticks) * (h - INSET * 2);
          return (
            <line
              key={tick}
              x1={0}
              x2={w}
              y1={y}
              y2={y}
              stroke="var(--color-border)"
            />
          );
        })}
        {crossesZero ? (
          <line
            x1={0}
            x2={w}
            y1={geometry.base}
            y2={geometry.base}
            stroke="var(--color-foreground)"
            strokeOpacity={0.4}
          />
        ) : null}
        {area ? (
          <path d={geometry.area} fill={stroke} fillOpacity={0.07} />
        ) : null}
        <path
          d={geometry.line}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {projection.length === 0 ? null : (
          <path
            d={geometry.tail}
            fill="none"
            stroke="var(--color-muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
      </svg>

      {marks.map((at) => {
        const sample = points[at];
        if (sample === undefined) return null;
        return (
          <span
            key={at}
            aria-hidden
            className="ring-card bg-foreground absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
            style={{ left: geometry.xOf(at), top: geometry.yOf(sample.y) }}
          />
        );
      })}

      {end === undefined ? null : (
        <span
          aria-hidden
          className={`${AXIS} absolute -translate-x-full -translate-y-full pr-1 whitespace-nowrap`}
          style={{
            left: geometry.xOf(points.length + projection.length - 1),
            top: geometry.yOf(end.y),
          }}
        >
          ≈ {end.x}
        </span>
      )}

      {point === undefined ? null : (
        <CrosshairLayer
          x={geometry.xOf(marked)}
          y={geometry.yOf(point.y)}
          accent={accent}
          rule={index !== null}
        />
      )}

      <div
        {...handlers}
        tabIndex={0}
        aria-label="Step through the series with the left and right arrow keys"
        className="focus-visible:outline-ring absolute inset-0 cursor-crosshair outline-none focus-visible:outline-1 focus-visible:outline-solid"
      />
    </>
  );
}

export function LineChart({
  points,
  currency,
  step = false,
  area = false,
  accent = false,
  marks = NO_MARKS,
  projection = NO_PROJECTION,
  expanded = false,
  empty = "No data in this window.",
}: {
  points: readonly Point[];
  /** The chart formats its own axis: a function cannot cross into a client component. */
  currency: string;
  step?: boolean;
  area?: boolean;
  /** Reserved for money kept, which is the only series that carries the accent. */
  accent?: boolean;
  /** Sample indices that were an event rather than a reading — a buy, a payment. */
  marks?: readonly number[];
  /** Where the series lands if nothing changes; drawn dashed, past the readings. */
  projection?: readonly Point[];
  expanded?: boolean;
  empty?: string;
}) {
  const hover = useSnapIndex(points.length);
  const format = compactOf(currency);

  if (!hasMovement(points)) {
    return <p className="text-muted-foreground text-xs">{empty}</p>;
  }

  const { top, bottom } = extremesOf(points, projection);
  const { low, high } = paddedDomain(bottom, top);
  // A series that crosses zero is measured against zero, not against its floor.
  const crossesZero = bottom < 0 && top > 0;
  const ticks = expanded ? EXPANDED_TICKS : TICKS;
  const marked = hover.index ?? points.length - 1;
  const point = points[marked];

  // Chosen over the whole span, so a projection's own end is the last tick
  // rather than a second one crowding the history's.
  const total = points.length + projection.length;
  const axis = pointScale(total, 100);
  const shown = labelIndices(total, expanded);

  return (
    <ChartFrame
      chart="line"
      readout={
        <>
          <p className="sr-only">
            {`Line chart, ${points.length} samples, ${format(bottom)} to ${format(top)}.`}
          </p>
          <ChartReadout
            x={point?.x}
            rows={compact([
              point === undefined
                ? undefined
                : { key: "value", value: format(point.y) },
              marks.includes(marked) ? { key: "buy", value: "buy" } : undefined,
            ])}
          />
        </>
      }
      yAxis={
        <div className="flex w-12 shrink-0 flex-col justify-between pr-1.5 text-right">
          {range(ticks).map((tick) => (
            <span key={tick} className={AXIS}>
              {format(high - shareOf(tick, ticks) * (high - low))}
            </span>
          ))}
        </div>
      }
      xAxis={
        <div className="relative h-4 shrink-0 pt-1 pl-12">
          {shown.map((at) => (
            <span
              key={at}
              className={`${AXIS} absolute whitespace-nowrap`}
              style={{
                left: `${axis(at) ?? 0}%`,
                transform: anchorOf(at, total),
              }}
            >
              {(points[at] ?? projection[at - points.length])?.x}
            </span>
          ))}
        </div>
      }
      plot={(size) => (
        <Plot
          size={size}
          plotted={{
            points,
            projection,
            step,
            area,
            accent,
            marks,
            ticks,
            low,
            high,
            crossesZero,
          }}
          index={hover.index}
          handlers={hover.handlers}
        />
      )}
    />
  );
}
