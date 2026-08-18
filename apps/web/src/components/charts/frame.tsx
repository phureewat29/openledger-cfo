"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@openledger-cfo/ui";

export interface ChartSize {
  readonly w: number;
  readonly h: number;
}

type Listener = (size: ChartSize) => void;

/**
 * Sub-pixel width changes are differences no chart can draw, so sizes round to
 * this step: a drag across the window then re-runs a layout a few times rather
 * than once per frame.
 */
const QUANTUM = 8;

const quantize = (value: number) => Math.round(value / QUANTUM) * QUANTUM;

const listeners = new WeakMap<Element, Set<Listener>>();
/** Sizes seen since the last frame; one flush serves every chart on the page. */
const pending = new Map<Element, ChartSize>();
let frame = 0;

const flush = () => {
  frame = 0;
  const batch = [...pending];
  pending.clear();
  for (const [element, size] of batch) {
    for (const listener of listeners.get(element) ?? []) listener(size);
  }
};

const measure = (entries: readonly ResizeObserverEntry[]) => {
  for (const entry of entries) {
    const { width, height } = entry.contentRect;
    pending.set(entry.target, { w: quantize(width), h: quantize(height) });
  }
  if (frame === 0) frame = requestAnimationFrame(flush);
};

/**
 * One observer for every chart on the page. Per-instance observers each wake
 * the layout engine on the same frame for the same window resize.
 */
const observer =
  typeof ResizeObserver === "undefined"
    ? undefined
    : new ResizeObserver(measure);

const observeChart = (element: Element, listener: Listener): (() => void) => {
  const registered = listeners.get(element) ?? new Set<Listener>();
  registered.add(listener);
  listeners.set(element, registered);
  observer?.observe(element);

  return () => {
    registered.delete(listener);
    if (registered.size > 0) return;
    listeners.delete(element);
    pending.delete(element);
    observer?.unobserve(element);
  };
};

const same = (current: ChartSize | null, next: ChartSize) =>
  current !== null && current.w === next.w && current.h === next.h;

/**
 * Null until the element has been measured, which is the same answer the
 * server gives: a chart drawn in pixel space may only gate what it adds on
 * top of the markup both renders agree on.
 */
export const useChartSize = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartSize | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    return observeChart(element, (next) =>
      setSize((current) => (same(current, next) ? current : next)),
    );
  }, []);

  return { ref, size };
};

/**
 * Everything that carries type renders on the server; only the plot waits for
 * a measurement, so an axis and a readout are never missing from the first
 * paint of a chart whose geometry is in pixels.
 */
export function ChartFrame({
  chart,
  readout,
  yAxis,
  xAxis,
  legend,
  plot,
  plotClassName,
}: {
  chart: string;
  readout?: React.ReactNode;
  yAxis?: React.ReactNode;
  xAxis?: React.ReactNode;
  legend?: React.ReactNode;
  plot: (size: ChartSize) => React.ReactNode;
  plotClassName?: string;
}) {
  const { ref, size } = useChartSize();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-chart={chart}>
      {readout}
      <div className="flex min-h-0 flex-1">
        {yAxis}
        <div
          ref={ref}
          className={cn("relative min-h-0 min-w-0 flex-1", plotClassName)}
        >
          {size === null ? null : plot(size)}
        </div>
      </div>
      {xAxis}
      {legend}
    </div>
  );
}
