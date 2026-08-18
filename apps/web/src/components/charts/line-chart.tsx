"use client";

import { useMemo } from "react";
import { extent } from "d3-array";
import { scaleLinear, scalePoint } from "d3-scale";
import {
  curveLinear,
  curveStepAfter,
  area as toArea,
  line as toLine,
} from "d3-shape";
import { range } from "es-toolkit";

import type { ChartSize } from "~/components/charts/frame";
import type { SnapHandlers } from "~/components/charts/hover";
import type { Point } from "~/domain/series/types";
import { ChartFrame } from "~/components/charts/frame";
import {
  ChartReadout,
  CrosshairLayer,
  useSnapIndex,
} from "~/components/charts/hover";
import { compactOf } from "~/domain/format";
import { hasMovement } from "~/domain/series/account";

/**
 * The band the data plots into. A dot on an extreme carries a 2px ring, and a
 * clipped ring reads as a square, so the extremes sit a dot's radius inside.
 */
const INSET = 6;
/** The span a flat series is lent, having none of its own to be drawn against. */
const MIN_SPAN = 1;
const AXIS = "text-muted-foreground text-[10px] tabular-nums";
const TICKS = 3;
const EXPANDED_TICKS = 5;
/** Past this the dates on the axis start running into each other. */
const EXPANDED_LABELS = 12;

const NO_MARKS: readonly number[] = [];
const NO_PROJECTION: readonly Point[] = [];

/**
 * One authority for where sample `i` sits. The plot asks in pixels and the
 * axis in percent, which is what lets the type render before anything is
 * measured.
 */
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

/**
 * The band the plot and the axis both work in. A series too flat to fill
 * MIN_SPAN is lent the shortfall evenly at both ends, so it sits down the
 * middle rather than against an edge, and the axis reads the band it was
 * actually drawn in.
 */
const domainOf = (bottom: number, top: number) => {
  const raw = top - bottom;
  const span = Math.max(raw, MIN_SPAN);
  const pad = (span - raw) / 2;
  return { low: bottom - pad, high: top + pad };
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

interface Plotted {
  readonly points: readonly Point[];
  readonly projection: readonly Point[];
  readonly step: boolean;
  readonly area: boolean;
  readonly accent: boolean;
  readonly marks: readonly number[];
  readonly ticks: number;
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
  const { points, projection, step, area, accent, marks, ticks } = plotted;

  // Keyed on the data and the box alone, so a pointer move, a focus or a poll
  // can never reach the layout.
  const geometry = useMemo(() => {
    const { top, bottom } = extremesOf(points, projection);
    const { low, high } = domainOf(bottom, top);
    // No `.nice()`: the axis beside it prints this domain rather than round
    // numbers of its own, so there is nothing for a rounded one to line up with.
    const yOf = scaleLinear()
      .domain([low, high])
      .range([h - INSET, INSET]);
    const x = pointScale(points.length + projection.length, w);
    const xOf = (at: number) => x(at) ?? 0;
    const curve = step ? curveStepAfter : curveLinear;
    // A series that crosses zero is measured against zero, not against its floor.
    const crossesZero = bottom < 0 && top > 0;
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
      crossesZero,
      line: linePath(points) ?? "",
      area: areaPath(points) ?? "",
      tail: last === undefined ? "" : (tailPath([last, ...projection]) ?? ""),
    };
  }, [points, projection, step, w, h]);

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
        {geometry.crossesZero ? (
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
        className="focus-visible:outline-ring absolute inset-0 cursor-crosshair outline-none focus-visible:outline-1"
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
  const { low, high } = domainOf(bottom, top);
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
            rows={[
              ...(point === undefined
                ? []
                : [{ key: "value", value: format(point.y) }]),
              ...(marks.includes(marked) ? [{ key: "buy", value: "buy" }] : []),
            ]}
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
          plotted={{ points, projection, step, area, accent, marks, ticks }}
          index={hover.index}
          handlers={hover.handlers}
        />
      )}
    />
  );
}
