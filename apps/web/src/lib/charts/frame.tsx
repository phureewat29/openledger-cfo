"use client";

import { useEffect, useRef, useState } from "react";

export interface ChartSize {
  readonly w: number;
  readonly h: number;
}

type Listener = (size: ChartSize) => void;

// Sizes round to this step, so a window drag re-runs a layout a few times, not per frame.
const QUANTUM = 8;

export const quantize = (value: number) =>
  Math.round(value / QUANTUM) * QUANTUM;

// One observer for every chart on the page, flushed once per frame.
const createSizeHub = () => {
  const listeners = new WeakMap<Element, Set<Listener>>();
  /** Sizes seen since the last frame; one flush serves every chart on the page. */
  const pending = new Map<Element, ChartSize>();
  let frame = 0;

  const flush = () => {
    frame = 0;
    const batch = [...pending];
    pending.clear();
    batch.forEach(([element, size]) =>
      listeners.get(element)?.forEach((listener) => listener(size)),
    );
  };

  const measure = (entries: readonly ResizeObserverEntry[]) => {
    entries.forEach(({ target, contentRect }) =>
      pending.set(target, { w: contentRect.width, h: contentRect.height }),
    );
    if (frame === 0) frame = requestAnimationFrame(flush);
  };

  // The server renders this module too, and it has no observer to give.
  const observer =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(measure);

  const observe = (element: Element, listener: Listener): (() => void) => {
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

  return { observe };
};

const sizes = createSizeHub();

const same = (current: ChartSize | null, next: ChartSize) =>
  current !== null && current.w === next.w && current.h === next.h;

// Null until measured, as on the server. A chart that derives its own boxes
// passes an exact `round` and quantizes what it derives.
export const useChartSize = (round: (value: number) => number = quantize) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ChartSize | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    return sizes.observe(element, ({ w, h }) => {
      const next = { w: round(w), h: round(h) };
      setSize((current) => (same(current, next) ? current : next));
    });
  }, [round]);

  return { ref, size };
};

// Type renders on the server; only the plot waits for a measurement.
export function ChartFrame({
  chart,
  readout,
  yAxis,
  xAxis,
  plot,
}: {
  chart: string;
  readout?: React.ReactNode;
  yAxis?: React.ReactNode;
  xAxis?: React.ReactNode;
  plot: (size: ChartSize) => React.ReactNode;
}) {
  const { ref, size } = useChartSize();

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-chart={chart}>
      {readout}
      <div className="flex min-h-0 flex-1">
        {yAxis}
        <div ref={ref} className="relative min-h-0 min-w-0 flex-1">
          {size === null ? null : plot(size)}
        </div>
      </div>
      {xAxis}
    </div>
  );
}
