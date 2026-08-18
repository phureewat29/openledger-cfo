"use client";

import { useRef, useState } from "react";
import { clamp } from "es-toolkit";

import { cn } from "@openledger-cfo/ui";

/** Arrow keys walk the same samples the pointer snaps to. */
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * Snaps the pointer to the nearest sample. The plot's box is read once when the
 * pointer arrives and dropped when it leaves, so a move costs one subtraction
 * and a comparison — never a layout read. A visit is short enough that nothing
 * can resize under it.
 */
export const useSnapIndex = (count: number) => {
  const [index, setIndex] = useState<number | null>(null);
  const current = useRef<number | null>(null);
  const box = useRef<DOMRect | null>(null);
  const clientX = useRef(0);
  const frame = useRef(0);

  const commit = (next: number | null) => {
    if (next === current.current) return;
    current.current = next;
    setIndex(next);
  };

  const snap = () => {
    frame.current = 0;
    const rect = box.current;
    if (rect === null || rect.width === 0) return;
    const share = (clientX.current - rect.left) / rect.width;
    commit(clamp(Math.round(share * (count - 1)), 0, count - 1));
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
      box.current ??= event.currentTarget.getBoundingClientRect();
      clientX.current = event.clientX;
      if (frame.current === 0) frame.current = requestAnimationFrame(snap);
    },
    onPointerLeave: () => {
      cancel();
      box.current = null;
      commit(null);
    },
    onFocus: () => commit(count - 1),
    onBlur: () => {
      cancel();
      commit(null);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      // Escape only belongs to the chart while it has something to clear;
      // otherwise it is the enclosing dialog's to act on.
      if (event.key === "Escape") {
        if (current.current === null) return;
        event.preventDefault();
        commit(null);
        return;
      }
      const step = STEP[event.key];
      if (step === undefined) return;
      event.preventDefault();
      commit(clamp((current.current ?? count - 1) + step, 0, count - 1));
    },
  };

  return { index, handlers };
};

export type SnapHandlers = ReturnType<typeof useSnapIndex>["handlers"];

/**
 * HTML on top of the plot rather than marks inside it: a viewBox stretched to
 * its slot would flatten a dot into an ellipse and thin the hairline.
 */
export function CrosshairLayer({
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
  readonly label?: string;
}

/**
 * The guaranteed channel: a tooltip can be clipped or missed, so every figure
 * the cursor reaches also lands in one fixed place clear of the plot.
 */
export function ChartReadout({
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
          {row.label === undefined ? null : (
            <span className="text-muted-foreground text-[10px]">
              {row.label}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
